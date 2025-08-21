import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface DateRanges {
  trainingStart: string;
  trainingEnd: string;
  testingStart: string;
  testingEnd: string;
  simulationStart: string;
  simulationEnd: string;
}

@Injectable({
  providedIn: 'root'
})
export class DateRangeService {
  private dateRanges = new BehaviorSubject<DateRanges | null>(null);
  currentDateRanges = this.dateRanges.asObservable();

  setDateRanges(ranges: DateRanges): void {
    this.dateRanges.next(ranges);
  }

  getCurrentDateRanges(): DateRanges | null {
    return this.dateRanges.value;
  }
}
