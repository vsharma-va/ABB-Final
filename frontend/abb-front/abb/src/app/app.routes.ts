// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { UploadComponent } from './upload/upload.component';
import { DateRangeComponent } from './date-range/date-range.component';
import { ModelTrainingComponent } from './model-training/model-training.component';
import { SimulationComponent } from './simulation/simulation.component';
export const routes: Routes = [
  { 
    path: '',
    redirectTo: '/upload',
    pathMatch: 'full'
  },
  {
    path: 'upload',
    component: UploadComponent
  },
  {
    path: 'date-range',
    component: DateRangeComponent
  },
  {
    path: 'model-training/:datasetId',
    component: ModelTrainingComponent
  },
  {
    path: 'simulation',
    component: SimulationComponent
  }
];