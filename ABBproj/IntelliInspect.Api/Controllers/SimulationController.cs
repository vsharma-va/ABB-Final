
using System.Text;
using System.Text.Json;
using IntelliInspect.Api.Models;
using IntelliInspect.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace IntelliInspect.Api.Controllers;

[ApiController]
[Route("")]
public class SimulationController : ControllerBase
{
    private readonly ISimulationService _sim;
    public SimulationController(ISimulationService sim) => _sim = sim;

    [HttpGet("simulation-stream")]
    public async Task SimulationStream([FromQuery] SimulateQuery q, CancellationToken ct)
    {
        // Set headers for a Server-Sent Events (SSE) stream
        Response.Headers[HeaderNames.CacheControl] = "no-cache";
        Response.Headers[HeaderNames.Connection]   = "keep-alive";
        Response.Headers["X-Accel-Buffering"]      = "no";
        Response.ContentType = "text/event-stream";

        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        
        var total = 0; var pass = 0; var fail = 0; double sum = 0;

        try
        {
            // Iterate over the asynchronous stream from the service
            await foreach (var evt in _sim.StreamAsync(q, ct))
            {
                if (ct.IsCancellationRequested) break;
                
                // Update summary statistics
                total++;
                if (evt.Prediction.Equals("Pass", StringComparison.OrdinalIgnoreCase)) pass++;
                else if (evt.Prediction.Equals("Fail", StringComparison.OrdinalIgnoreCase)) fail++;
                sum += evt.Confidence;

                // Manually format the SSE message and write it to the response body
                var message = $"data: {JsonSerializer.Serialize(evt, jsonOpts)}\n\n";
                var bytes = Encoding.UTF8.GetBytes(message);
                await Response.Body.WriteAsync(bytes, 0, bytes.Length, ct);
                await Response.Body.FlushAsync(ct);
            }

            // After the loop, send a final 'done' event with the summary
            var summary = new SimulationSummaryDto(total, pass, fail, total > 0 ? Math.Round(sum / total, 2) : 0);
            var doneMessage = $"event: done\ndata: {JsonSerializer.Serialize(summary, jsonOpts)}\n\n";
            var doneBytes = Encoding.UTF8.GetBytes(doneMessage);
            await Response.Body.WriteAsync(doneBytes, 0, doneBytes.Length, ct);
            await Response.Body.FlushAsync(ct);
        }
        catch (Exception ex)
        {
            // If an error occurs, send an 'error' event
            if (!Response.HasStarted)
            {
                var errorMessage = $"event: error\ndata: {JsonSerializer.Serialize(new { error = ex.Message }, jsonOpts)}\n\n";
                var errorBytes = Encoding.UTF8.GetBytes(errorMessage);
                await Response.Body.WriteAsync(errorBytes, 0, errorBytes.Length, ct);
                await Response.Body.FlushAsync(ct);
            }
        }
    }
}
