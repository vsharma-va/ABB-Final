import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ModelTrainingService, TrainingMetrics } from '../services/model-training.service';
import { DateRangeService } from '../services/date-range.service';
import { Chart, registerables } from 'chart.js';

// Register Chart.js components
Chart.register(...registerables);

@Component({
  selector: 'app-model-training',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './model-training.component.html',
  styleUrls: ['./model-training.component.css']
})
export class ModelTrainingComponent implements OnInit, OnDestroy {
  datasetId: string = '';
  isLoading: boolean = false;
  trainingInProgress: boolean = false;
  trainingComplete: boolean = false;
  error: string | null = null;
  metrics: TrainingMetrics | null = null;
  modelType: string = 'xgboost';
  
  private lossChart: Chart | null = null;
  private confusionChart: Chart | null = null;

  simulationInProgress: boolean = false;
  simulationComplete: boolean = false;
  currentSimulationTime: Date | null = null;
  simulationData: any[] = [];
  livePredictions: any[] = [];
  simulationStats = {
    total: 0,
    pass: 0,
    fail: 0,
    avgConfidence: 0
  };
  private simulationInterval: any;
  private currentIndex: number = 0;
  private testData: any[] = []; // This will hold the test data for simulation

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private modelTrainingService: ModelTrainingService,
    private dateRangeService: DateRangeService
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      this.datasetId = params['datasetId'];
    });
  }

  ngOnDestroy(): void {
    this.lossChart?.destroy();
    this.confusionChart?.destroy();
    clearInterval(this.simulationInterval);
  }

  trainModel(): void {
    if (!this.datasetId) {
      this.error = 'No dataset ID found';
      return;
    }

    this.isLoading = true;
    this.trainingInProgress = true;
    this.error = null;

    this.modelTrainingService.trainModel(this.datasetId, this.modelType).subscribe({
      next: (response: TrainingMetrics) => {
        this.metrics = response;
        this.trainingComplete = true;
        this.trainingInProgress = false;
        this.isLoading = false;
        setTimeout(() => {
          this.createCharts();
        }, 0);
        // this.createCharts();
      },
      error: (err: any) => {
        console.error('Error training model:', err);
        this.error = err.error?.message || 'Failed to train model. Please try again.';
        this.isLoading = false;
        this.trainingInProgress = false;
      }
    });
  }

  startSimulation(): void {
    if (!this.metrics?.ModelId) {
      this.error = 'No trained model available for simulation';
      return;
    }

    // Reset simulation state
    this.simulationInProgress = true;
    this.simulationComplete = false;
    this.livePredictions = [];
    this.currentIndex = 0;
    this.simulationStats = { total: 0, pass: 0, fail: 0, avgConfidence: 0 };

    // Get test data for simulation
    this.modelTrainingService.getTestData(this.datasetId).subscribe({
      next: (data) => {
        this.testData = data;
        this.simulationStats.total = this.testData.length;
        this.runSimulation();
      },
      error: (err) => {
        console.error('Error fetching test data:', err);
        this.error = 'Failed to load test data for simulation';
        this.simulationInProgress = false;
      }
    });
  }

  private runSimulation(): void {
    clearInterval(this.simulationInterval);
    
    this.simulationInterval = setInterval(() => {
      if (this.currentIndex >= this.testData.length) {
        this.completeSimulation();
        return;
      }

      const currentData = this.testData[this.currentIndex];
      this.currentSimulationTime = new Date(currentData.timestamp);
      
      // Simulate model prediction
      const prediction = {
        ...currentData,
        prediction: Math.random() > 0.5 ? 'Pass' : 'Fail',
        confidence: Math.floor(Math.random() * 30) + 70 // Random confidence between 70-100
      };

      // Update live predictions (keep last 50 for performance)
      this.livePredictions = [prediction, ...this.livePredictions].slice(0, 50);

      // Update stats
      if (prediction.prediction === 'Pass') {
        this.simulationStats.pass++;
      } else {
        this.simulationStats.fail++;
      }
      
      // Calculate average confidence
      const totalConfidence = this.livePredictions.reduce((sum, p) => sum + p.confidence, 0);
      this.simulationStats.avgConfidence = totalConfidence / this.livePredictions.length;

      this.currentIndex++;
    }, 1000); // Emit every second
  }

  private completeSimulation(): void {
    clearInterval(this.simulationInterval);
    this.simulationInProgress = false;
    this.simulationComplete = true;
  }

  private createCharts(): void {
    if (!this.metrics) return;

    this.createLossChart();
    this.createConfusionMatrixChart();
  }

  private createLossChart(): void {
    const ctx = document.getElementById('lossChart') as HTMLCanvasElement;
    if (!ctx) {
      console.error('Loss chart canvas element not found');
      return;
    }
    
    if (!this.metrics?.GraphData) {
      console.error('No graph data available for loss chart');
      console.log('Metrics:', this.metrics);
      return;
    }

    console.log('Creating loss chart with data:', this.metrics.GraphData);

    if (this.lossChart) {
      this.lossChart.destroy();
    }

    const epochs = Array.from({ length: this.metrics.GraphData.length }, (_, i) => i + 1);
    
    try {
      this.lossChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: epochs,
          datasets: [
            {
              label: 'Training Loss',
              data: this.metrics.GraphData,
              borderColor: 'rgb(75, 192, 192)',
              tension: 0.1,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: 'Training Loss Over Epochs'
            },
            tooltip: {
              callbacks: {
                label: (context: any) => `Loss: ${context.parsed.y.toFixed(4)}`
              }
            }
          },
          scales: {
            x: {
              title: {
                display: true,
                text: 'Epochs'
              }
            },
            y: {
              title: {
                display: true,
                text: 'Loss'
              },
              beginAtZero: false
            }
          }
        }
      });
      console.log('Loss chart created successfully');
    } catch (error) {
      console.error('Error creating loss chart:', error);
    }
  }

  private createConfusionMatrixChart(): void {
    const ctx = document.getElementById('confusionMatrixChart') as HTMLCanvasElement;
    if (!ctx) {
      console.error('Confusion matrix canvas element not found');
      return;
    }
    
    if (!this.metrics?.Confusion) {
      console.error('No confusion matrix data available');
      console.log('Metrics:', this.metrics);
      return;
    }

    console.log('Creating confusion matrix with data:', this.metrics.Confusion);

    if (this.confusionChart) {
      this.confusionChart.destroy();
    }

    const { TP, FP, TN, FN } = this.metrics.Confusion;
    const total = TP + FP + TN + FN;
    
    try {
      this.confusionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: [
            `True Positives (${((TP / total) * 100).toFixed(1)}%)`,
            `False Positives (${((FP / total) * 100).toFixed(1)}%)`,
            `True Negatives (${((TN / total) * 100).toFixed(1)}%)`,
            `False Negatives (${((FN / total) * 100).toFixed(1)}%)`
          ],
          datasets: [{
            data: [TP, FP, TN, FN],
            backgroundColor: [
              'rgba(75, 192, 192, 0.8)', // TP - teal
              'rgba(255, 99, 132, 0.8)',  // FP - red
              'rgba(54, 162, 235, 0.8)',  // TN - blue
              'rgba(255, 205, 86, 0.8)'   // FN - yellow
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: 'Confusion Matrix'
            },
            legend: {
              position: 'right',
              labels: {
                padding: 20,
                boxWidth: 12,
                usePointStyle: true,
                pointStyle: 'circle'
              }
            }
          }
        }
      });
      console.log('Confusion matrix chart created successfully');
    } catch (error) {
      console.error('Error creating confusion matrix chart:', error);
    }
  }

  navigateBack(): void {
    this.router.navigate(['/date-range', this.datasetId]);
  }

  navigateToSimulation(): void {
    // Scroll to the simulation section
    this.router.navigate([
      '/simulation',
    ])
  }
}
