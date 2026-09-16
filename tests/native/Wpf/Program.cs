using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        var directory = Path.GetFullPath(args.Single());
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "manifest.json")));
        var reports = new List<object>();
        foreach (var fixture in manifest.RootElement.EnumerateArray())
        {
            var name = fixture.GetProperty("name").GetString()!;
            Console.WriteLine($"WPF loading {name}");
            // Only repository-owned, compiler-generated fixtures are loaded. Not an untrusted-XAML sandbox.
            var root = (FrameworkElement)XamlReader.Parse(File.ReadAllText(Path.Combine(directory, fixture.GetProperty("file").GetString()!)));
            var assertions = Validate(root, fixture.GetProperty("expected"));
            var saved = XamlWriter.Save(root);
            var reloaded = (FrameworkElement)XamlReader.Parse(saved);
            assertions += Validate(reloaded, fixture.GetProperty("expected"));
            reports.Add(new { name, assertions, load = true, measureArrange = true, nativeSaveReload = true });
        }
        var report = new { framework = "WPF", runtime = Environment.Version.ToString(), assembly = typeof(FrameworkElement).Assembly.FullName, cases = reports };
        File.WriteAllText(Path.Combine(directory, "qualification.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"WPF qualified {reports.Count} fixtures with real native load, measure/arrange, property checks and save/reload.");
    }
    private static IEnumerable<DependencyObject> Descendants(DependencyObject root)
    {
        yield return root;
        foreach (var child in LogicalTreeHelper.GetChildren(root).OfType<DependencyObject>())
            foreach (var descendant in Descendants(child)) yield return descendant;
    }
    private static int Validate(FrameworkElement root, JsonElement expected)
    {
        root.Measure(new Size(1600, 1200));
        root.Arrange(new Rect(0, 0, double.IsNaN(root.Width) ? 1600 : root.Width, double.IsNaN(root.Height) ? 1200 : root.Height));
        root.UpdateLayout();
        if (!double.IsFinite(root.ActualWidth) || !double.IsFinite(root.ActualHeight)) throw new Exception("Nonfinite native layout.");
        var nodes = Descendants(root).OfType<FrameworkElement>().Where(n => !string.IsNullOrEmpty(n.Name)).ToDictionary(n => n.Name);
        var count = 0;
        foreach (var node in expected.EnumerateObject())
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
                var expectedValue = property.Value;
                bool matches = expectedValue.ValueKind switch
                {
                    JsonValueKind.Null => value is null,
                    JsonValueKind.Number => value is not null && Math.Abs(Convert.ToDouble(value, CultureInfo.InvariantCulture) - expectedValue.GetDouble()) < 0.01,
                    JsonValueKind.True or JsonValueKind.False => value is bool flag && flag == expectedValue.GetBoolean(),
                    JsonValueKind.Array => value is Thickness t && new[] { t.Left, t.Top, t.Right, t.Bottom }.Zip(expectedValue.EnumerateArray().Select(v => v.GetDouble())).All(pair => Math.Abs(pair.First - pair.Second) < 0.01),
                    _ => Convert.ToString(value, CultureInfo.InvariantCulture) == expectedValue.GetString()
                };
                if (!matches) throw new Exception($"{node.Name}.{property.Name}: actual {value}, expected {expectedValue}");
                count++;
            }
        }
        return count;
    }
}
