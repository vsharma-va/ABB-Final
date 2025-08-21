// src/app/upload/upload.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { DatasetService, DatasetMetadata } from '../services/dataset.service';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css']
})
export class UploadComponent {
  private http = inject(HttpClient);
  private router = inject(Router);
  private datasetService = inject(DatasetService);
  
  fileName: string = '';
  file: File | null = null;
  isUploading: boolean = false;
  uploadResult: DatasetMetadata | null = null;
  error: string | null = null;
  supportedFormats = ['.csv'];
  uploadProgress: number = 0;

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    
    if (!input.files?.length) return;
    
    const file = input.files[0];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (fileExtension && !this.supportedFormats.includes(fileExtension)) {
      this.error = 'Unsupported file format. Please upload a CSV file.';
      return;
    }
    
    this.error = null;
    this.file = file;
    this.fileName = file.name;
    this.uploadProgress = 0; // Reset progress when new file is selected
  }

  onUpload(): void {
    if (!this.file) return;
    
    this.isUploading = true;
    this.error = null;
    
    const formData = new FormData();
    formData.append('file', this.file);
    
    this.http.post<DatasetMetadata>('http://localhost:5189/api/datasets/upload', formData)
      .pipe(
        catchError((error) => {
          console.error('Upload failed:', error);
          this.error = error.error?.message || 'An error occurred while uploading the file. Please try again.';
          this.isUploading = false;
          return of(null);
        }),
        finalize(() => {
          this.isUploading = false;
        })
      )
      .subscribe({
        next: (result) => {
          if (result) {
            this.uploadResult = result;
            this.datasetService.setMetadata(result);
          }
        }
      });
  }

  formatDate(dateString: string | null | undefined): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  resetForm(): void {
    this.file = null;
    this.fileName = '';
    this.uploadResult = null;
    this.error = null;
    this.uploadProgress = 0;
    
    const fileInput = document.querySelector('.file-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  navigateToDateRange(): void {
    if (this.uploadResult) {
      this.router.navigate(['/date-range']);
    }
  }
}