namespace IntelliInspect.Api.Models;

public record TrainModelResponse(
    string ModelId,
    MetricSummary Metrics,
    ConfusionCounts Confusion,
    List<double> GraphData,
    string StatusMessage = "Model Trained Successfully"
);

public record MetricSummary(double Accuracy, double Precision, double Recall, double F1);

public record ConfusionCounts(long TP, long TN, long FP, long FN);