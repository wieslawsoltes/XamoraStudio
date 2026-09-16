using System.Globalization;
using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.LogicalTree;
using Avalonia.Markup.Xaml;
using Avalonia.Themes.Fluent;
using Avalonia.Threading;

public sealed class FixtureApplication : Application
{
    public override void Initialize() => Styles.Add(new FluentTheme());
}
internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        AppBuilder.Configure<FixtureApplication>().UseHeadless(new AvaloniaHeadlessPlatformOptions()).SetupWithoutStarting();
        var directory = Path.GetFullPath(args.Single());
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "manifest.json")));
        var reports = new List<object>();
        foreach (var fixture in manifest.RootElement.EnumerateArray())
        {
            var name = fixture.GetProperty("name").GetString()!;
            Console.WriteLine($"Avalonia loading {name}");
            // Trusted compiler fixtures only. Runtime XAML loading is not a security sandbox.
            var root = AvaloniaRuntimeXamlLoader.Parse<Control>(File.ReadAllText(Path.Combine(directory, fixture.GetProperty("file").GetString()!)));
            var window = new Window { Content = root, Width = 1600, Height = 1200 };
            window.Show();
            try
            {
                root.Measure(new Size(1600, 1200));
                root.Arrange(new Rect(0, 0, double.IsNaN(root.Width) ? 1600 : root.Width, double.IsNaN(root.Height) ? 1200 : root.Height));
                Dispatcher.UIThread.RunJobs();
                if (!double.IsFinite(root.Bounds.Width) || !double.IsFinite(root.Bounds.Height)) throw new Exception("Nonfinite native layout.");
                var nodes = root.GetLogicalDescendants().Prepend(root).OfType<Control>().Where(n => !string.IsNullOrEmpty(n.Name)).ToDictionary(n => n.Name!);
                var assertions = 0;
                foreach (var node in fixture.GetProperty("expected").EnumerateObject())
                {
                    if (!nodes.TryGetValue(node.Name, out var target)) throw new Exception($"Missing native node {node.Name}");
                    foreach (var property in node.Value.EnumerateObject())
                    {
                        object? value = property.Name switch
                        {
                            "Canvas.Left" => Canvas.GetLeft(target),
                            "Canvas.Top" => Canvas.GetTop(target),
                            _ => target.GetType().GetProperty(property.Name)?.GetValue(target)
                        };
                        var expected = property.Value;
                        bool matches = expected.ValueKind switch
                        {
                            JsonValueKind.Null => value is null,
                            JsonValueKind.Number => value is not null && Math.Abs(Convert.ToDouble(value, CultureInfo.InvariantCulture) - expected.GetDouble()) < 0.01,
                            JsonValueKind.True or JsonValueKind.False => value is bool flag && flag == expected.GetBoolean(),
                            JsonValueKind.Array => value is Thickness t && new[] { t.Left, t.Top, t.Right, t.Bottom }.Zip(expected.EnumerateArray().Select(v => v.GetDouble())).All(pair => Math.Abs(pair.First - pair.Second) < 0.01),
                            _ => Convert.ToString(value, CultureInfo.InvariantCulture) == expected.GetString()
                        };
                        if (!matches) throw new Exception($"{node.Name}.{property.Name}: actual {value}, expected {expected}");
                        assertions++;
                    }
                }
                reports.Add(new { name, assertions, load = true, measureArrange = true });
            }
            finally { window.Close(); }
        }
        var report = new { framework = "Avalonia", runtime = Environment.Version.ToString(), assembly = typeof(Control).Assembly.FullName, backend = "headless-layout-not-pixel-rendering", cases = reports };
        File.WriteAllText(Path.Combine(directory, "qualification.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"Avalonia qualified {reports.Count} fixtures with actual framework load, measure/arrange and property checks.");
    }
}
