using System.Globalization;
using CsvHelper;
using CsvHelper.Configuration;
using IntelliInspect.Api.Models;
using IntelliInspect.Api.Storage;

namespace IntelliInspect.Api.Services;

public class DatasetService : IDatasetService
{
    private const string ResponseColumn = "Response";
    private const string TimestampColumn = "synthetic_timestamp";
    private const string PythonTimestamp = "timestamp";
    private static readonly DateTimeOffset Start = new(2021,1,1,0,0,0, TimeSpan.Zero);

    private readonly IStorage _storage;
    public DatasetService(IStorage storage) => _storage = storage;

    public async Task<UploadResultDto> IngestAndProcessAsync(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0) throw new InvalidOperationException("Empty file.");
        if (!Path.GetExtension(file.FileName).Equals(".csv", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Only .csv files are allowed.");

        var datasetId = Guid.NewGuid().ToString("N");
        await _storage.SaveFileAsync(datasetId, "original.csv", file.OpenReadStream(), ct);

        var folder = await _storage.GetOrCreateDatasetFolderAsync(datasetId, ct);
        await using var input = await _storage.OpenFileAsync(datasetId, "original.csv", ct)
                                ?? throw new FileNotFoundException("Original not saved.");
        await using var output = File.Create(Path.Combine(folder, "processed.csv"));

        var config = new CsvConfiguration(CultureInfo.InvariantCulture)
        {
            BadDataFound = null,
            DetectDelimiter = true
        };

        using var reader = new StreamReader(input);
        using var csvIn = new CsvReader(reader, config);
        using var writer = new StreamWriter(output);
        using var csvOut = new CsvWriter(writer, CultureInfo.InvariantCulture);

        // Header processing
        await csvIn.ReadAsync();
        csvIn.ReadHeader();
        var headers = csvIn.HeaderRecord?.ToList() ?? new List<string>();
        if (!headers.Contains(ResponseColumn))
            throw new InvalidOperationException($"CSV must contain '{ResponseColumn}' column.");

        bool hadSynthetic = headers.Contains(TimestampColumn);
        bool hadPythonTs = headers.Contains(PythonTimestamp);

        if (!hadSynthetic) headers.Add(TimestampColumn);
        if (!hadPythonTs) headers.Add(PythonTimestamp);

        foreach (var h in headers) csvOut.WriteField(h);
        await csvOut.NextRecordAsync();

        // --- START OF FIX ---

        long total = 0;
        long pass = 0;
        var cols = headers.Count;
        DateTimeOffset? minTs = null, maxTs = null;

        while (await csvIn.ReadAsync())
        {
            total++;

            // First, write the entire row to the output file
            foreach (var h in headers)
            {
                if ((h == TimestampColumn && !hadSynthetic) || (h == PythonTimestamp && !hadPythonTs))
                {
                    // Generate a timestamp if one doesn't exist
                    var ts = Start.AddSeconds(total - 1);
                    csvOut.WriteField(ts.ToUniversalTime().ToString("o"));
                }
                else if (h == PythonTimestamp && !hadPythonTs && hadSynthetic)
                {
                    // Mirror the synthetic value to the python timestamp column if needed
                    var synVal = csvIn.GetField(TimestampColumn);
                    csvOut.WriteField(synVal);
                }
                else
                {
                    // Passthrough existing data
                    csvOut.WriteField(csvIn.GetField(h));
                }
            }
            await csvOut.NextRecordAsync();
            if (csvIn.GetField(ResponseColumn) == "1") pass++;

            // Now, determine the timestamp for the current row and update min/max
            DateTimeOffset? currentRowTs = null;
            if (hadSynthetic)
            {
                // If the original file had a timestamp, parse it
                if (DateTimeOffset.TryParse(csvIn.GetField(TimestampColumn), null, DateTimeStyles.AssumeUniversal, out var parsedTs))
                {
                    currentRowTs = parsedTs;
                }
            }
            else if (hadPythonTs)
            {
                // If the original file had the python timestamp, parse it
                if (DateTimeOffset.TryParse(csvIn.GetField(PythonTimestamp), null, DateTimeStyles.AssumeUniversal, out var parsedTs))
                {
                    currentRowTs = parsedTs;
                }
            }
            else
            {
                // Otherwise, use the timestamp we just generated
                currentRowTs = Start.AddSeconds(total - 1);
            }

            // Update the overall min and max values
            if (currentRowTs.HasValue)
            {
                if (minTs == null || currentRowTs.Value < minTs) minTs = currentRowTs.Value;
                if (maxTs == null || currentRowTs.Value > maxTs) maxTs = currentRowTs.Value;
            }
        }

        // Handle case where file is empty or has no valid timestamps
        if (minTs is null) minTs = Start;
        if (maxTs is null) maxTs = Start.AddSeconds(Math.Max(0, total - 1));

        // --- END OF FIX ---

        var passRate = total == 0 ? 0 : Math.Round((100.0 * pass) / total, 2);

        var metadata = new DatasetMetadataDto(
            TotalRecords: total,
            TotalColumns: cols,
            PassRatePercent: passRate,
            EarliestSyntheticTimestamp: minTs.Value,
            LatestSyntheticTimestamp: maxTs.Value
        );

        return new UploadResultDto(datasetId, file.FileName, metadata);
    }

    public async Task<DatasetMetadataDto?> GetMetadataAsync(string datasetId, CancellationToken ct)
    {
        var exists = await _storage.FileExistsAsync(datasetId, "processed.csv", ct);
        if (!exists) return null;

        var config = new CsvConfiguration(CultureInfo.InvariantCulture) { DetectDelimiter = true };
        await using var stream = await _storage.OpenFileAsync(datasetId, "processed.csv", ct);
        using var reader = new StreamReader(stream!);
        using var csv = new CsvReader(reader, config);

        await csv.ReadAsync();
        csv.ReadHeader();
        var headers = csv.HeaderRecord?.ToList() ?? new();
        var cols = headers.Count;

        long total = 0;
        long pass = 0;
        DateTimeOffset? minTs = null, maxTs = null;

        while (await csv.ReadAsync())
        {
            total++;
            if (csv.GetField(ResponseColumn) == "1") pass++;

            var tsStr = headers.Contains(PythonTimestamp) ? csv.GetField(PythonTimestamp) : csv.GetField(TimestampColumn);
            if (DateTimeOffset.TryParse(tsStr, out var ts))
            {
                if (minTs == null || ts < minTs) minTs = ts;
                if (maxTs == null || ts > maxTs) maxTs = ts;
            }
        }

        var passRate = total == 0 ? 0 : Math.Round((100.0 * pass) / total, 2);
        return new DatasetMetadataDto(
            TotalRecords: total,
            TotalColumns: cols,
            PassRatePercent: passRate,
            EarliestSyntheticTimestamp: minTs ?? DateTimeOffset.MinValue,
            LatestSyntheticTimestamp: maxTs ?? DateTimeOffset.MinValue
        );
    }

    public async Task<ValidateRangesResponse> ValidateRangesAsync(string datasetId, ValidateRangesRequest req, CancellationToken ct)
    {
        var errors = new List<string>();

        var metadata = await GetMetadataAsync(datasetId, ct);
        if (metadata is null)
        {
            throw new FileNotFoundException("Dataset not found or not processed.");
        }
        var datasetMinTs = metadata.EarliestSyntheticTimestamp;
        var datasetMaxTs = metadata.LatestSyntheticTimestamp;

        // --- START OF CHANGES ---

        // 2. Parse the standard ISO 8601 date strings.
        // The default TryParse is perfect for this format.
        if (!DateTimeOffset.TryParse(req.Training.Start, out var trainingStart))
            errors.Add("Invalid Training start date format. Expected ISO 8601 format (e.g., 2021-01-01T05:30:00).");
        if (!DateTimeOffset.TryParse(req.Training.End, out var trainingEnd))
            errors.Add("Invalid Training end date format. Expected ISO 8601 format.");

        if (!DateTimeOffset.TryParse(req.Testing.Start, out var testingStart))
            errors.Add("Invalid Testing start date format. Expected ISO 8601 format.");
        if (!DateTimeOffset.TryParse(req.Testing.End, out var testingEnd))
            errors.Add("Invalid Testing end date format. Expected ISO 8601 format.");

        if (!DateTimeOffset.TryParse(req.Simulation.Start, out var simulationStart))
            errors.Add("Invalid Simulation start date format. Expected ISO 8601 format.");
        if (!DateTimeOffset.TryParse(req.Simulation.End, out var simulationEnd))
            errors.Add("Invalid Simulation end date format. Expected ISO 8601 format.");
            
        // --- END OF CHANGES ---

        // If any date string was invalid, we can't proceed with logical checks.
        if (errors.Any())
        {
            return new ValidateRangesResponse(true, errors, false, false, false);
        }
        
        // ... (The rest of your method remains the same) ...
        // 3. Perform chronological and boundary validations
        if (trainingStart < datasetMinTs) errors.Add($"Training start must be on or after {datasetMinTs:yyyy-MM-dd HH:mm:ss}.");
        if (trainingEnd > datasetMaxTs) errors.Add($"Training end must be on or before {datasetMaxTs:yyyy-MM-dd HH:mm:ss}.");
        if (testingStart < datasetMinTs) errors.Add($"Testing start must be on or after {datasetMinTs:yyyy-MM-dd HH:mm:ss}.");
        if (testingEnd > datasetMaxTs) errors.Add($"Testing end must be on or before {datasetMaxTs:yyyy-MM-dd HH:mm:ss}.");
        if (simulationStart < datasetMinTs) errors.Add($"Simulation start must be on or after {datasetMinTs:yyyy-MM-dd HH:mm:ss}.");
        if (simulationEnd > datasetMaxTs) errors.Add($"Simulation end must be on or before {datasetMaxTs:yyyy-MM-dd HH:mm:ss}.");
        
        if (trainingStart > trainingEnd) errors.Add("Training start date must be before or same as its end date.");
        if (testingStart > testingEnd) errors.Add("Testing start date must be before or same as its end date.");
        if (simulationStart > simulationEnd) errors.Add("Simulation start date must be before or same as its end date.");
        if (testingStart <= trainingEnd) errors.Add("Testing period must begin after the Training period ends.");
        if (simulationStart <= testingEnd) errors.Add("Simulation period must begin after the Testing period ends.");


        long trainCount = 0, testCount = 0, simCount = 0;
        var path = Path.Combine(await _storage.GetOrCreateDatasetFolderAsync(datasetId, ct), "processed.csv");

        using (var reader = new StreamReader(path))
        {
            var cfg = new CsvConfiguration(CultureInfo.InvariantCulture) { DetectDelimiter = true };
            using var csv = new CsvReader(reader, cfg);
            await csv.ReadAsync();
            csv.ReadHeader();
            var headers = csv.HeaderRecord?.ToList() ?? new();
            var tsCol = headers.Contains(PythonTimestamp) ? PythonTimestamp : TimestampColumn;

            while (await csv.ReadAsync())
            {
                var tsStr = csv.GetField(tsCol);
                if (!DateTimeOffset.TryParse(tsStr, out var ts)) continue;

                if (ts >= trainingStart && ts <= trainingEnd) trainCount++;
                else if (ts >= testingStart && ts <= testingEnd) testCount++;
                else if (ts >= simulationStart && ts <= simulationEnd) simCount++;
            }
        }

        var status = errors.Count == 0 ? "Valid" : "Invalid";
        return new ValidateRangesResponse(
            status != "Valid",
            errors,
            true,
            true,
            true
        );
    }
}
