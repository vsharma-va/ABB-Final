# ABB Final – Multi-Service App (FastAPI · .NET · Angular)

## What this project does (Overview)
This is a three-service application:

- FastAPI (Python) – lightweight backend for core APIs (auth, simple data endpoints).
- .NET API (C#) – main business/API layer (industrial/ABB simulation, device/inspection endpoints).
- Angular Frontend – web UI to interact with both backends.

Typical local ports:
- FastAPI: http://127.0.0.1:8000
- .NET API: https://localhost:5001 or http://localhost:5000
- Angular: http://localhost:4200

---

## Tech stack
- Frontend: Angular, TypeScript, Node.js
- APIs: FastAPI (Python 3.11/3.12), .NET 7/8
- Tooling: npm, Angular CLI, venv (Python), dotnet SDK

---

## Prerequisites
- Python 3.11+ (3.12 recommended)
- Node.js 20.17.x LTS or >= 22.9.0
- npm 10.x+ (npm 11.x requires Node >= 22.9.0 or 20.17.x)
- Angular CLI
- .NET SDK 7 or 8

---

### 1) FastAPI server

Mac/Linux:
- cd ABB-Final
- python3 -m venv env
- source env/bin/activate
- python -m pip install -U pip setuptools wheel
- pip install -r requirements.txt
- uvicorn main:app --reload


Windows (PowerShell):
- cd ABB-Final
- python -m venv env
- .\env\Scripts\activate
- python -m pip install -U pip setuptools wheel
- pip install -r requirements.txt
- uvicorn main:app --reload


---

### 2) .NET API
- cd ABB-Final/ABBproj/IntelliInspect.Api
- dotnet build
- dotnet run



---

### 3) Angular frontend
- cd ABB-Final/frontend/abb-front/abb
- npm install
- npm install -g @angular/cli
- ng serve



Then open:  
- http://localhost:4200

---


