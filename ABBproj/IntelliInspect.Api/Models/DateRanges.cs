namespace IntelliInspect.Api.Models;

// single source of truth for date-range models

public record DateRangeDto(string Start, string End);

public record ValidateRangesRequest(
    DateRangeDto Training,
    DateRangeDto Testing,
    DateRangeDto Simulation
);

public record RangeBucket(string Month, int Training, int Testing, int Simulation);

// use a small record for the per-period summary

public record ValidateRangesResponse(
    bool Error,
    List<string> ErrorList,
    bool Training,        // training period summary
    bool Testing,         // testing period summary
    bool Simulation      // simulation period summary
);
