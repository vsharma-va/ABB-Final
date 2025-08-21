import { Injectable, NgZone, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

// This interface matches the DTO from your .NET backend
export interface SimulationData {
  time: string;
  sampleId: string;
  prediction: string;
  confidence: number;
  temperature: number | null;
  pressure: number | null;
  humidity: number | null;
}

// Defines the possible states of the data stream
export type StreamStatus = 'idle' | 'connecting' | 'active' | 'completed' | 'error';

@Injectable({
  providedIn: 'root'
})
export class SimulationService {
  // --- Private Subjects to manage and emit data, status, and errors ---
  private dataSubject = new BehaviorSubject<SimulationData[]>([]);
  private statusSubject = new BehaviorSubject<StreamStatus>('idle');
  private errorSubject = new Subject<string | null>();
  
  private eventSource: EventSource | null = null;
  private simulationDataStore: SimulationData[] = [];
  private isBrowser: boolean;

  // --- Public Observables for components to subscribe to ---
  public readonly dataStream$: Observable<SimulationData[]> = this.dataSubject.asObservable();
  public readonly status$: Observable<StreamStatus> = this.statusSubject.asObservable();
  public readonly errorStream$: Observable<string | null> = this.errorSubject.asObservable();

  constructor(
    private zone: NgZone,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /**
   * Starts a new Server-Sent Events (SSE) stream from the .NET backend.
   * This method uses the browser's native EventSource API and only runs on the browser.
   * @param datasetId - The ID of the dataset to simulate.
   * @param startTime - The start time for the simulation.
   * @param endTime - The end time for the simulation.
   */
  startSimulationStream(datasetId: string, startTime: string, endTime: string): void {
    // Guard clause: Do not run this code on the server.
    if (!this.isBrowser) {
      return;
    }

    // Stop any existing stream before starting a new one
    this.stopSimulationStream();
    this.resetState();

    // Construct the API endpoint URL.
    // NOTE: The '/api' path is configured to be proxied to your .NET backend
    // to avoid CORS issues during development. See proxy.conf.json.
    const url = `http://localhost:5189/simulation-stream?datasetId=${datasetId}&start=${startTime}&end=${endTime}&usePython=true`;

    this.statusSubject.next('connecting');

    try {
      this.eventSource = new EventSource(url);

      // Listener for when the connection is successfully opened
      this.eventSource.onopen = () => {
        // Run inside NgZone to ensure Angular's change detection is triggered
        this.zone.run(() => {
          this.statusSubject.next('active');
          this.errorSubject.next(null);
        });
      };

      // Listener for incoming messages from the server
      this.eventSource.onmessage = (event) => {
        const newData: SimulationData = JSON.parse(event.data);
        
        // The backend might send a structured error message within the stream
        if ((newData as any).prediction === 'error') {
            this.zone.run(() => {
                this.errorSubject.next((newData as any).sampleId); // sampleId field is used for the error message
                this.statusSubject.next('error');
                this.stopSimulationStream();
            });
            return;
        }

        this.simulationDataStore.push(newData);
        
        this.zone.run(() => {
          this.dataSubject.next([...this.simulationDataStore]);
        });
      };

      // Listener for any errors with the stream
      this.eventSource.onerror = (error) => {
        this.zone.run(() => {
          // The 'onerror' handler is also called when the connection is closed by the server,
          // which is the normal way an SSE stream ends. We check the readyState.
          if (this.eventSource?.readyState === EventSource.CLOSED) {
            this.statusSubject.next('completed');
          } else {
            console.error('EventSource failed:', error);
            this.errorSubject.next('Failed to connect to the simulation stream. Ensure the backend is running and the proxy is configured.');
            this.statusSubject.next('error');
          }
          // In either case (complete or error), we close our connection.
          this.stopSimulationStream();
        });
      };
    } catch (error) {
        console.error("Failed to create EventSource:", error);
        this.errorSubject.next('An unexpected error occurred while trying to start the simulation.');
        this.statusSubject.next('error');
    }
  }

  /**
   * Closes the active SSE connection.
   */
  stopSimulationStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Resets the internal state of the service for a new simulation run.
   */
  private resetState(): void {
    this.simulationDataStore = [];
    this.dataSubject.next([]);
    this.statusSubject.next('idle');
    this.errorSubject.next(null);
  }
}
