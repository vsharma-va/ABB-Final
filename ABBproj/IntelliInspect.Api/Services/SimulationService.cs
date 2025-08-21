
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using CsvHelper;
using CsvHelper.Configuration;
using IntelliInspect.Api.Models;

namespace IntelliInspect.Api.Services;

public class SimulationService : ISimulationService
{
    private readonly IHttpClientFactory _http;
    private readonly string _storageRoot;

    // This helper class is designed to match the exact JSON structure
    // coming from the FastAPI stream.
    private class PythonSimEvent
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public string Timestamp { get; set; } = string.Empty;

        [JsonPropertyName("prediction")]
        public string Prediction { get; set; } = "Unknown";

        [JsonPropertyName("confidence")]
        public double Confidence { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }
    }

    public SimulationService(IHttpClientFactory http, IConfiguration cfg)
    {
        _http = http;
        _storageRoot = cfg["Storage:Root"] ?? "./data";
    }

    public async IAsyncEnumerable<SimEventDto> StreamAsync(SimulateQuery q, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        // This method acts as a router.
        // If UsePython is true, it calls the dedicated Python streaming method.
        if (q.UsePython)
        {
            await foreach (var item in StreamFromPythonAsync(q, ct))
            {
                yield return item;
            }
        }
        // Otherwise, it falls back to the local CSV reading logic.
        else
        {
            await foreach (var item in StreamFromCsvAsync(q, ct))
            {
                yield return item;
            }
        }
    }

    private async IAsyncEnumerable<SimEventDto> StreamFromPythonAsync(SimulateQuery q, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        var client = _http.CreateClient("ml");
        
        var simStart = q.Start.ToString("yyyy-MM-dd'T'HH:mm:ss");
        var simEnd = q.End.ToString("yyyy-MM-dd'T'HH:mm:ss");
        var requestUri = $"/simulation-stream?sim_start={simStart}&sim_end={simEnd}";
        
        Stream? stream = null;
        Exception? connectionException = null;

        try
        {
            // This block ONLY handles the initial connection and stream acquisition.
            var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
            var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            response.EnsureSuccessStatusCode();
            stream = await response.Content.ReadAsStreamAsync(ct);
        }
        catch (Exception ex)
        {
            // Instead of yielding, we just capture the exception.
            connectionException = ex;
        }

        // Now, completely outside the try-catch block, we can safely yield.
        if (connectionException != null)
        {
            yield return new SimEventDto(DateTimeOffset.UtcNow, "error", $"Failed to connect to simulation stream: {connectionException.Message}", 0, null, null, null);
            // Stop the enumeration.
            yield break;
        }
        
        // If we got here without an exception, the stream should be valid.
        if (stream == null) yield break;

        // If the connection was successful, we proceed to read the stream.
        await using (stream)
        using (var reader = new StreamReader(stream))
        {
            // Read the stream line by line until the connection is closed or cancelled.
            while (!reader.EndOfStream && !ct.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(ct);

                // Server-Sent Events (SSE) format each message as "data: {json_payload}"
                if (string.IsNullOrEmpty(line) || !line.StartsWith("data: "))
                {
                    continue;
                }

                // Extract the JSON part of the message.
                var jsonData = line["data: ".Length..];
                var simEvent = JsonSerializer.Deserialize<PythonSimEvent>(jsonData);

                if (simEvent == null) continue;
                
                // If the stream sends an error message, yield it and stop.
                if (!string.IsNullOrEmpty(simEvent.Error))
                {
                    yield return new SimEventDto(DateTimeOffset.UtcNow, "error", simEvent.Error, 0, null, null, null);
                    break;
                }

                DateTimeOffset.TryParse(simEvent.Timestamp, out var ts);
                var confPct = Math.Round(simEvent.Confidence * 100.0, 2);

                // Create the final DTO. Note that telemetry values (temp, pressure, humidity)
                // are null because they are not provided by the Python stream.
                yield return new SimEventDto(ts, simEvent.Id, simEvent.Prediction, confPct, null, null, null);
            }
        }
    }

    // This method for reading from CSV is kept as a fallback and is not used
    // when the 'UsePython' flag is true.
    private async IAsyncEnumerable<SimEventDto> StreamFromCsvAsync(SimulateQuery q, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        var csvPath = Path.Combine(_storageRoot, q.DatasetId, "processed.csv");
        if (!File.Exists(csvPath))
            yield break;

        var config = new CsvConfiguration(CultureInfo.InvariantCulture) { DetectDelimiter = true, BadDataFound = null };
        using var reader = new StreamReader(csvPath);
        using var csv = new CsvReader(reader, config);

        await csv.ReadAsync();
        csv.ReadHeader();
        var headers = csv.HeaderRecord?.ToHashSet(StringComparer.OrdinalIgnoreCase) ?? new();

        var tsCol = headers.Contains("timestamp") ? "timestamp" : "synthetic_timestamp";
        var idCol = headers.Contains("Id") ? "Id" : headers.Contains("SampleId") ? "SampleId" : headers.Contains("RowId") ? "RowId" : null;

        var tempCol = headers.FirstOrDefault(h => string.Equals(h, "temperature", StringComparison.OrdinalIgnoreCase));
        var presCol = headers.FirstOrDefault(h => string.Equals(h, "pressure", StringComparison.OrdinalIgnoreCase));
        var humCol  = headers.FirstOrDefault(h => string.Equals(h, "humidity", StringComparison.OrdinalIgnoreCase));

        var delay = TimeSpan.FromSeconds(q.Speed <= 0 ? 1 : 1.0 / q.Speed);

        while (await csv.ReadAsync())
        {
            if (ct.IsCancellationRequested) yield break;
            if (!DateTimeOffset.TryParse(csv.GetField(tsCol), out var ts)) continue;
            if (ts < q.Start || ts > q.End) continue;

            var respVal = headers.Contains("Response") ? csv.GetField("Response") : null;
            var labelText = respVal == "1" ? "Pass" : "Fail";
            var confPct = 100.0;

            var sampleIdFromCsv = idCol != null ? csv.GetField(idCol) : null;
            var sampleId = !string.IsNullOrWhiteSpace(sampleIdFromCsv) ? sampleIdFromCsv : $"row-{csv.Context.Parser.Row}";

            double? temp = TryGetDouble(csv, tempCol);
            double? pres = TryGetDouble(csv, presCol);
            double? hum  = TryGetDouble(csv, humCol);

            yield return new SimEventDto(ts, sampleId, labelText, confPct, temp, pres, hum);

            if (delay > TimeSpan.Zero)
                await Task.Delay(delay, ct);
        }
    }

    private static double? TryGetDouble(CsvReader csv, string? col)
    {
        if (string.IsNullOrEmpty(col)) return null;
        var v = csv.GetField(col);
        return double.TryParse(v, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;
    }
}
