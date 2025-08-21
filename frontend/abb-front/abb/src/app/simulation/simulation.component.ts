import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import { Subscription } from 'rxjs';
// Import the new service and its data types
import { SimulationService, SimulationData, StreamStatus } from '../services/simulation.service';
import { DateRangeService } from '../services/date-range.service';
import {DatasetService} from '../services/dataset.service';

// Angular Material Modules
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';

// Interface to add a calculated quality score for the chart
interface ProcessedSimulationData extends SimulationData {
  qualityScore: number;
}

@Component({
  selector: 'app-simulation',
  templateUrl: './simulation.component.html',
  styleUrls: ['./simulation.component.css'],
  standalone: true,
  imports: [
    CommonModule, RouterModule, DecimalPipe,
    MatTableModule, MatButtonModule, MatCardModule, MatProgressSpinnerModule, MatIconModule
  ]
})
export class SimulationComponent implements OnInit, AfterViewInit, OnDestroy {
  // --- Component State ---
  isSimulating = false;
  simulationComplete = false;
  isLoading = true; // Start in loading state
  error: string | null = null;
  
  // --- Chart Instances ---
  private lineChart: Chart | null = null;
  private donutChart: Chart | null = null;
  
  // --- Subscriptions ---
  private subscriptions = new Subscription();
  
  // --- Simulation Parameters (with default values) ---
  private datasetId: string = "";
  private startTime: string = "";
  private endTime: string = "";

  // --- Data & Statistics ---
  simulationData: ProcessedSimulationData[] = [];
  displayedColumns: string[] = ['time', 'sampleId', 'prediction', 'confidence', 'temperature', 'humidity', 'pressure'];
  totalPredictions = 0;
  passCount = 0;
  failCount = 0;
  averageConfidence = 0;

  private isBrowser: boolean;
  private dateRangeService: DateRangeService;
  private datasetService: DatasetService;

  constructor(
    private route: ActivatedRoute,
    private simulationService: SimulationService,
    private cdr: ChangeDetectorRef,
    dateRangeService: DateRangeService,
    datasetService: DatasetService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.dateRangeService = dateRangeService;
    this.datasetService = datasetService;
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      Chart.register(...registerables);
    }
  }

  ngOnInit(): void {
    // Override default simulation parameters with any provided query params
    this.subscriptions.add(
      this.route.queryParams.subscribe(params => {
        this.datasetId = params['datasetId'] || this.datasetId;
        this.startTime = params['startTime'] || this.startTime;
        this.endTime = params['endTime'] || this.endTime;
      })
    );
    this.datasetId = this.datasetService.getMetadata()?.DatasetId || this.datasetId;
    this.startTime = this.dateRangeService.getCurrentDateRanges()?.simulationStart || this.startTime;
    this.endTime = this.dateRangeService.getCurrentDateRanges()?.simulationEnd || this.endTime;

    
    this.subscribeToSimulationStreams();
    // Automatically start the simulation on component load
    this.startSimulation();
  }

  ngAfterViewInit(): void {
    // Initialize charts after the view is ready and only in the browser
    if (this.isBrowser) {
      this.initializeCharts();
    }
  }

  ngOnDestroy(): void {
    // Clean up all subscriptions and stop any active simulation
    this.subscriptions.unsubscribe();
    this.simulationService.stopSimulationStream();
    this.destroyCharts();
  }

  /**
   * Subscribes to the observables from the SimulationService to reactively update the UI.
   */
  private subscribeToSimulationStreams(): void {
    // 1. Subscribe to the data stream
    this.subscriptions.add(
      this.simulationService.dataStream$.subscribe(data => {
        this.processData(data);
        this.updateCharts();
        this.cdr.detectChanges();
      })
    );

    // 2. Subscribe to the status stream
    this.subscriptions.add(
      this.simulationService.status$.subscribe(status => {
        this.handleStreamStatus(status);
        this.cdr.detectChanges();
      })
    );

    // 3. Subscribe to the error stream
    this.subscriptions.add(
      this.simulationService.errorStream$.subscribe(errorMessage => {
        this.error = errorMessage;
        if (errorMessage) {
          this.isSimulating = false;
          this.simulationComplete = false;
        }
        this.cdr.detectChanges();
      })
    );
  }

  /**
   * Handles UI state changes based on the stream's status.
   */
  private handleStreamStatus(status: StreamStatus): void {
      this.isLoading = status === 'connecting';
      this.isSimulating = status === 'active';
      this.simulationComplete = status === 'completed';
      
      if (status === 'completed' || status === 'error') {
          this.isSimulating = false;
      }
  }

  /**
   * Starts or restarts the simulation.
   */
  startSimulation(): void {
    this.resetSimulationState();
    this.simulationService.startSimulationStream(
      this.datasetId,
      this.startTime,
      this.endTime
    );
  }

  /**
   * Processes the full dataset received from the stream to update statistics.
   */
  private processData(data: SimulationData[]): void {
    this.simulationData = data.map(d => ({
      ...d,
      qualityScore: d.prediction === 'Pass' 
        ? 70 + (d.confidence / 100 * 30) 
        : 70 - (d.confidence / 100 * 30)
    })).reverse(); // Reverse to show latest data at the top of the table

    this.totalPredictions = data.length;
    this.passCount = data.filter(d => d.prediction === 'Pass').length;
    this.failCount = data.filter(d => d.prediction === 'Fail').length;
    
    this.averageConfidence = this.totalPredictions > 0
      ? data.reduce((sum, item) => sum + item.confidence, 0) / this.totalPredictions
      : 0;
  }

  // --- Chart Management ---

  private initializeCharts(): void {
    if (!this.isBrowser) return;

    const lineCtx = document.getElementById('lineChart') as HTMLCanvasElement;
    if (lineCtx) {
      this.lineChart = new Chart(lineCtx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Quality Score', data: [], borderColor: 'rgb(75, 192, 192)', tension: 0.1 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } } }
      });
    }

    const donutCtx = document.getElementById('donutChart') as HTMLCanvasElement;
    if (donutCtx) {
      this.donutChart = new Chart(donutCtx, {
        type: 'doughnut',
        data: { labels: ['Pass', 'Fail'], datasets: [{ data: [0, 0], backgroundColor: ['#4CAF50', '#F44336'] }] },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  }

  private updateCharts(): void {
    if (!this.isBrowser || !this.lineChart || !this.donutChart) return;

    // Take the latest 50 data points for performance and display them chronologically
    const chartData = this.simulationData.slice(0, 50).reverse();
    const timeLabels = chartData.map(d => new Date(d.time).toLocaleTimeString());
    const qualityScores = chartData.map(d => d.qualityScore);

    if (this.lineChart) {
        this.lineChart.data.labels = timeLabels;
        this.lineChart.data.datasets[0].data = qualityScores;
        this.lineChart.update('none');
    }

    if (this.donutChart) {
        this.donutChart.data.datasets[0].data = [this.passCount, this.failCount];
        this.donutChart.update('none');
    }
  }

  private destroyCharts(): void {
      if (this.lineChart) this.lineChart.destroy();
      if (this.donutChart) this.donutChart.destroy();
  }

  /**
   * Resets all component state before a new simulation run.
   */
  private resetSimulationState(): void {
    this.error = null;
    this.simulationData = [];
    this.totalPredictions = 0;
    this.passCount = 0;
    this.failCount = 0;
    this.averageConfidence = 0;
    this.simulationComplete = false;
    
    if (this.lineChart) {
        this.lineChart.data.labels = [];
        this.lineChart.data.datasets[0].data = [];
        this.lineChart.update();
    }
    if (this.donutChart) {
        this.donutChart.data.datasets[0].data = [0, 0];
        this.donutChart.update();
    }
  }
}
