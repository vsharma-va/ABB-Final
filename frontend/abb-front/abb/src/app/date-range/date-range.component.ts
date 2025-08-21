import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Chart, registerables, ChartConfiguration, ChartData, LegendItem } from 'chart.js';
import { Router } from '@angular/router';
import { DatasetService, DatasetMetadata } from '../services/dataset.service';
import { HttpClient } from '@angular/common/http';
import { DateRangeService } from '../services/date-range.service';

// Register Chart.js components
Chart.register(...registerables);

@Component({
  selector: 'app-date-range',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './date-range.component.html',
  styleUrls: ['./date-range.component.css']
})
export class DateRangeComponent implements OnInit, OnDestroy {
  private router: Router;
  private datasetService: DatasetService;
  private http: HttpClient;
  private dateRangeService: DateRangeService;

  metadata: DatasetMetadata | null = null;
  minDateTime: string = '';
  maxDateTime: string = '';
  trainingStart: string = '';
  trainingEnd: string = '';
  testingStart: string = '';
  testingEnd: string = '';
  simulationStart: string = '';
  simulationEnd: string = '';
  chart: Chart | null = null;
  validationResult: any = null;
  isLoading: boolean = false;
  errorMessage: string | null = null;

  // Check if all date ranges are filled
  get areAllDatesFilled(): boolean {
    return !!this.trainingStart && !!this.trainingEnd &&
           !!this.testingStart && !!this.testingEnd &&
           !!this.simulationStart && !!this.simulationEnd;
  }

  constructor(
    router: Router,
    datasetService: DatasetService,
    http: HttpClient,
    dateRangeService: DateRangeService
  ) {
    this.router = router;
    this.datasetService = datasetService;
    this.http = http;
    this.dateRangeService = dateRangeService;
  }

  ngOnInit(): void {
    this.metadata = this.datasetService.getMetadata();
    
    if (!this.metadata) {
      this.router.navigate(['/upload']);
      return;
    }

    // Set min and max datetime from metadata
    const minDate = new Date(this.metadata.Metadata.EarliestSyntheticTimestamp);
    const maxDate = new Date(this.metadata.Metadata.LatestSyntheticTimestamp);
    
    this.minDateTime = this.toDateTimeLocalString(minDate);
    this.maxDateTime = this.toDateTimeLocalString(maxDate);
    
    // Set default date ranges
    this.setDefaultDateRanges();
    
    // Create chart after the view is initialized
    setTimeout(() => this.createTimelineChart(), 0);
  }

  // Convert Date to YYYY-MM-DDTHH:MM:SS format for datetime-local input
  private toDateTimeLocalString(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  // Convert datetime-local string to Date
  private fromDateTimeLocalString(datetimeStr: string): Date {
    return new Date(datetimeStr);
  }

  /**
   * Sets the initial date ranges for training, testing, and simulation.
   */
  private setDefaultDateRanges(): void {
    if (!this.metadata) return;
    const earliestDate = new Date(this.metadata.Metadata.EarliestSyntheticTimestamp);
    const latestDate = new Date(this.metadata.Metadata.LatestSyntheticTimestamp);
    
    const dateRange = latestDate.getTime() - earliestDate.getTime();
    const trainingEndDate = new Date(earliestDate.getTime() + dateRange * 0.7);
    const testingEndDate = new Date(trainingEndDate.getTime() + dateRange * 0.15);
    
    this.trainingStart = this.toDateTimeLocalString(earliestDate);
    this.trainingEnd = this.toDateTimeLocalString(trainingEndDate);
    this.testingStart = this.toDateTimeLocalString(new Date(trainingEndDate.getTime() + 1000)); // Start next second
    this.testingEnd = this.toDateTimeLocalString(testingEndDate);
    this.simulationStart = this.toDateTimeLocalString(new Date(testingEndDate.getTime() + 1000)); // Start next second
    this.simulationEnd = this.toDateTimeLocalString(latestDate);
    console.log(this.trainingStart)
  }

  /**
   * Formats a date string for display purposes, including time.
   */
  formatDateForDisplay(dateString: string): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  /**
   * Validate and update date ranges
   */
  private validateAndUpdateDates(): void {
    if (!this.metadata) return;
    
    const minDate = new Date(this.metadata.Metadata.EarliestSyntheticTimestamp);
    const maxDate = new Date(this.metadata.Metadata.LatestSyntheticTimestamp);
    
    // Ensure dates are within bounds
    const clampDate = (date: Date): Date => {
      if (date < minDate) return new Date(minDate);
      if (date > maxDate) return new Date(maxDate);
      return date;
    };
    
    // Update dates with validation
    this.trainingStart = this.toDateTimeLocalString(clampDate(this.fromDateTimeLocalString(this.trainingStart)));
    this.trainingEnd = this.toDateTimeLocalString(clampDate(this.fromDateTimeLocalString(this.trainingEnd)));
    this.testingStart = this.toDateTimeLocalString(clampDate(this.fromDateTimeLocalString(this.testingStart)));
    this.testingEnd = this.toDateTimeLocalString(clampDate(this.fromDateTimeLocalString(this.testingEnd)));
    this.simulationStart = this.toDateTimeLocalString(clampDate(this.fromDateTimeLocalString(this.simulationStart)));
    this.simulationEnd = this.toDateTimeLocalString(clampDate(this.fromDateTimeLocalString(this.simulationEnd)));
    
    // Ensure start <= end for each period
    if (this.fromDateTimeLocalString(this.trainingStart) > this.fromDateTimeLocalString(this.trainingEnd)) {
      this.trainingEnd = this.trainingStart;
    }
    if (this.fromDateTimeLocalString(this.testingStart) > this.fromDateTimeLocalString(this.testingEnd)) {
      this.testingEnd = this.testingStart;
    }
    if (this.fromDateTimeLocalString(this.simulationStart) > this.fromDateTimeLocalString(this.simulationEnd)) {
      this.simulationEnd = this.simulationStart;
    }
  }

  ngOnDestroy(): void {
    if (this.chart) {
      this.chart.destroy();
    }
  }

  onDateChange(): void {
    this.validateAndUpdateDates();
    this.updateTimelineChart();
  }

  /**
   * Creates the initial horizontal timeline chart.
   */
  createTimelineChart(): void {
    if (!this.metadata) return;
    
    const ctx = document.getElementById('dateRangeChart') as HTMLCanvasElement;
    if (!ctx) return;
    
    if (this.chart) {
      this.chart.destroy();
    }
    
    const minDate = new Date(this.metadata.Metadata.EarliestSyntheticTimestamp);
    const maxDate = new Date(this.metadata.Metadata.LatestSyntheticTimestamp);

    const chartData: ChartData = {
      labels: ['Simulation', 'Testing', 'Training', 'Full Range'],
      datasets: [
        {
          label: 'Full Date Range',
          data: [
            null,
            null,
            null,
            [minDate.getTime(), maxDate.getTime()]
          ],
          backgroundColor: 'rgba(200, 200, 200, 0.3)',
          borderColor: 'rgba(200, 200, 200, 0.5)',
          borderWidth: 1,
          barThickness: 60, // Fixed height for each bar
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        },
        {
          label: 'Training Period',
          data: [
            null,
            null,
            [new Date(this.trainingStart).getTime(), new Date(this.trainingEnd).getTime()],
            null
          ],
          backgroundColor: 'rgba(75, 192, 192, 0.7)', // Green-Cyan
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
          barThickness: 30, // Fixed height for each bar
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        },
        {
          label: 'Testing Period',
          data: [
            null,
            [new Date(this.testingStart).getTime(), new Date(this.testingEnd).getTime()],
            null,
            null
          ],
          backgroundColor: 'rgba(255, 159, 64, 0.7)', // Orange
          borderColor: 'rgba(255, 159, 64, 1)',
          borderWidth: 1,
          barThickness: 30, // Fixed height for each bar
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        },
        {
          label: 'Simulation Period',
          data: [
            [new Date(this.simulationStart).getTime(), new Date(this.simulationEnd).getTime()],
            null,
            null,
            null
          ],
          backgroundColor: 'rgba(54, 162, 235, 0.7)', // Blue
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
          barThickness: 30, // Fixed height for each bar
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        }
      ]
    };

    const chartOptions: ChartConfiguration['options'] = {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          type: 'linear',
          position: 'bottom',
          min: minDate.getTime(),
          max: maxDate.getTime(),
          ticks: {
            callback: (value) => {
              return new Date(value).toLocaleDateString();
            }
          },
          title: {
            display: true,
            text: 'Timeline'
          },
          grid: {
            display: true
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            display: false
          },
          ticks: {
            font: {
              size: 12
            }
          },
          stacked: true
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context: any) => {
              const datasetLabel = context.dataset.label || '';
              const value = context.raw as [number, number];
              if (!value) return ''; // Don't show tooltip for null values
              const from = this.formatDateForDisplay(new Date(value[0]).toISOString());
              const to = this.formatDateForDisplay(new Date(value[1]).toISOString());
              return `${datasetLabel}: ${from} to ${to}`;
            }
          },
          padding: 10,
          titleFont: {
            size: 14
          },
          bodyFont: {
            size: 13
          }
        },
        legend: {
          display: true,
          position: 'top',
          labels: {
            padding: 20,
            font: {
              size: 13
            },
            usePointStyle: true,
            pointStyle: 'rectRounded'
          }
        }
      }
    };
    
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: chartData,
      options: chartOptions,
    });
  }

  /**
   * Updates the chart's data when date ranges are changed by the user.
   */
  updateTimelineChart(): void {
    if (!this.chart) return;
    
    // Update Training Period (dataset index 1, data index 2)
    (this.chart.data.datasets[1].data as any)[2] = [new Date(this.trainingStart).getTime(), new Date(this.trainingEnd).getTime()];
    
    // Update Testing Period (dataset index 2, data index 1)
    (this.chart.data.datasets[2].data as any)[1] = [new Date(this.testingStart).getTime(), new Date(this.testingEnd).getTime()];
    
    // Update Simulation Period (dataset index 3, data index 0)
    (this.chart.data.datasets[3].data as any)[0] = [new Date(this.simulationStart).getTime(), new Date(this.simulationEnd).getTime()];
    
    this.chart.update();
  }

  onProceed(): void {
    if (this.metadata?.DatasetId) {
      // Save the current date ranges to the service
      this.dateRangeService.setDateRanges({
        trainingStart: this.trainingStart,
        trainingEnd: this.trainingEnd,
        testingStart: this.testingStart,
        testingEnd: this.testingEnd,
        simulationStart: this.simulationStart,
        simulationEnd: this.simulationEnd
      });
      
      // Navigate to model training page
      this.router.navigate(['/model-training', this.metadata.DatasetId]);
    } else {
      console.error('No dataset ID available for model training');
      // Optionally show an error message to the user
    }
  }

  navigateBack(): void {
    this.router.navigate(['/upload']);
  }

  // Add this new method to validate date ranges
  validateDateRanges(): void {
    if (!this.metadata) return;
    
    this.isLoading = true;
    this.errorMessage = null;
    
    const payload = {
      Training: {
        Start: this.trainingStart,
        End: this.trainingEnd
      },
      Testing: {
        Start: this.testingStart,
        End: this.testingEnd
      },
      Simulation: {
        Start: this.simulationStart,
        End: this.simulationEnd
      }
    };

    this.http.post(`http://localhost:5189/api/datasets/${this.metadata.DatasetId}/validate-ranges`, payload)
      .subscribe({
        next: (response: any) => {
          this.validationResult = response;
          if (response.Error) {
            this.errorMessage = response.ErrorList?.join('\n') || 'Validation failed';
          }
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error validating date ranges:', error);
          this.errorMessage = 'Failed to validate date ranges. Please try again.';
          this.isLoading = false;
        }
      });
  }
}
