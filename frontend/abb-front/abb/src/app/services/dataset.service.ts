import { Injectable } from '@angular/core';

export interface DatasetMetadata {
  DatasetId: string;
  OriginalFileName: string;
  Metadata: {
    TotalRecords: number;
    TotalColumns: number;
    PassRatePercent: number;
    EarliestSyntheticTimestamp: string;
    LatestSyntheticTimestamp: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class DatasetService {
  private metadata: DatasetMetadata | null = null;

  setMetadata(metadata: DatasetMetadata): void {
    this.metadata = metadata;
  }

  getMetadata(): DatasetMetadata | null {
    return this.metadata;
  }

  clearMetadata(): void {
    this.metadata = null;
  }
}
