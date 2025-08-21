import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { DateRangeService } from './date-range.service';

// ... existing code ...

export interface TrainingMetrics {
  ModelId: string;
  Metrics: {
    Accuracy: number;
    Precision: number;
    Recall: number;
    F1: number;
  };
  Confusion: {
    TP: number;
    TN: number;
    FP: number;
    FN: number;
  };
  GraphData: number[];
  StatusMessage: string;
}

interface TrainModelRequest {
  DatasetId: string;
  TrainStart: string;
  TrainEnd: string;
  TestStart: string;
  TestEnd: string;
  Model: string;
}

@Injectable({
  providedIn: 'root'
})
export class ModelTrainingService {
  private apiUrl = 'http://localhost:5189/api';

  constructor(
    private http: HttpClient,
    private dateRangeService: DateRangeService
  ) {}

  trainModel(datasetId: string, modelType: string = 'xgboost'): Observable<TrainingMetrics> {
    const dateRanges = this.dateRangeService.getCurrentDateRanges();
    console.log(dateRanges);
    
    if (!dateRanges) {
      throw new Error('Date ranges not set. Please set date ranges before training.');
    }

    const payload: TrainModelRequest = {
      DatasetId: datasetId,
      TrainStart: dateRanges.trainingStart,
      TrainEnd: dateRanges.trainingEnd,
      TestStart: dateRanges.testingStart,
      TestEnd: dateRanges.testingEnd,
      Model: modelType
    };

    return this.http.post<TrainingMetrics>(`${this.apiUrl}/ml/train-model`, payload);
  }

  getTestData(datasetId: string): Observable<any[]> {
    // In a real application, this would make an HTTP request to your backend
    // For now, we'll generate some mock data
    return of(this.generateMockTestData());
  }

  private generateMockTestData(): any[] {
    const data = [];
    const now = new Date();
    
    for (let i = 0; i < 100; i++) {
      const timestamp = new Date(now.getTime() - (i * 1000)); // 1 second intervals
      data.push({
        timestamp: timestamp.toISOString(),
        sampleId: `SMP-${1000 - i}`,
        temperature: 20 + Math.random() * 10, // 20-30°C
        pressure: 980 + Math.random() * 40,   // 980-1020 hPa
        humidity: 40 + Math.random() * 40,    // 40-80%
        qualityScore: 70 + Math.random() * 30, // 70-100
      });
    }
    
    return data;
  }
}