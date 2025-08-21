from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from contextlib import asynccontextmanager
from enum import Enum
from model import XGB
import numpy as np
import json
import asyncio

app = FastAPI()

class MLModels(str, Enum):
    XGB = "xgboost"
    LIGHTGBM = "lightgbm"

class TrainPayload(BaseModel):
    train_start: str
    train_end: str
    test_start: str
    test_end: str
    model_name: MLModels
    file_name: str

class ModelResponse(BaseModel):
    error: str | None
    accuracy: float
    precision: float
    recall: float
    f1: float
    matrix: list 
    graph: list

models = {}

@app.post("/train-model", response_model=ModelResponse, status_code=200)
async def train_and_return_metrics(data: TrainPayload):
    if data.model_name == MLModels.XGB:
        file_name = "./ABBproj/IntelliInspect.Api/data/" + data.file_name
        x = XGB(data.train_start, data.train_end, data.test_start, data.test_end, file_name)
        x.train_and_predict()
        metrics = x.get_metrics()
        models['xgb'] = x
        if metrics['error'] != None:
            raise HTTPException(status_code=500, detail=metrics['error'])
        else:
            return metrics
        
async def run_simulation_stream(simulation_start: str, simulation_end: str):
    if not models:
        error_msg = {"error": "Model not trained. Please call the /train endpoint first."}
        yield f"data: {json.dumps(error_msg)}\n\n"
        return

    simulation_df = models['xgb'].df[
        (models['xgb'].df['timestamp'] >= simulation_start) &
        (models['xgb'].df['timestamp'] <= simulation_end)
    ].copy()

    if simulation_df.empty:
        error_msg = {"error": "No data available for the selected simulation period."}
        yield f"data: {json.dumps(error_msg)}\n\n"
        return

    for i in range(len(simulation_df)):
        try:
            features_for_prediction = simulation_df.iloc[i:i+1].drop(['timestamp', 'Response', 'synthetic_timestamp'], axis=1)
            prediction_proba = models['xgb'].model.predict_proba(features_for_prediction)[0]
            prediction = int(np.argmax(prediction_proba))
            confidence = float(np.max(prediction_proba))

            record = {
                "id": str(simulation_df.iloc[i]['Id']),
                "timestamp": simulation_df.iloc[i]['timestamp'].strftime('%Y-%m-%d %H:%M:%S'),
                "prediction": "Pass" if prediction == 0 else "Fail",
                "confidence": round(confidence, 4),
            }
            yield f"data: {json.dumps(record)}\n\n"
            await asyncio.sleep(1)

        except Exception as e:
            error_record = {"error": str(e)}
            yield f"data: {json.dumps(error_record)}\n\n"
            break

@app.get("/simulation-stream")
async def simulation_stream(sim_start: str, sim_end: str):
    sim_start += "+05:30"
    sim_end += "+05:30"
    print(sim_start, sim_end)
    return StreamingResponse(
        run_simulation_stream(sim_start, sim_end), 
        media_type="text/event-stream"
    )