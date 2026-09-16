using System.IO;
using System.Globalization;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 2) throw new ArgumentException("Provide fixture and report directories.");
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        Directory.CreateDirectory(args[1]);
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(args[0], "manifest.json")));
        var results = new List<object>();
        foreach (var fixture in manifest.RootElement.GetProperty("fixtures").EnumerateArray().Where(f => f.GetProperty("framework").GetString() == "WPF"))
        {
            var name = fixture.GetProperty("name").GetString()!;
            try
            {
                var view = (FrameworkElement)XamlReader.Parse(File.ReadAllText(Path.Combine(args[0], fixture.GetProperty("file").GetString()!)));
                var width = fixture.GetProperty("width").GetDouble();
                var height = fixture.GetProperty("height").GetDouble();
                view.Measure(new Size(width, height));
                view.Arrange(new Rect(0, 0, width, height));
                view.UpdateLayout();
                var checks = 0;
                foreach (var check in fixture.GetProperty("checks").EnumerateArray())
                {
                    var target = Descendants(view).OfType<FrameworkElement>().First(e => e.Name == check.GetProperty("name").GetString());
                    var origin = ReferenceEquals(target, view) ? new Point() : target.TransformToAncestor(view).Transform(new Point());
                    foreach (var (property, actual) in new[] { ("width", target.ActualWidth), ("height", target.ActualHeight), ("x", origin.X), ("y", origin.Y) })
                    {
                        if (check.TryGetProperty(property, out var expected) && (!double.IsFinite(actual) || Math.Abs(actual - expected.GetDouble()) > 0.15))
                            throw new InvalidOperationException($"{target.Name}.{property}: actual {actual} expected {expected}");
                        if (check.TryGetProperty(property, out _)) checks++;
                    }
                }
                foreach (var check in fixture.GetProperty("text").EnumerateArray())
                {
                    var target = Descendants(view).OfType<FrameworkElement>().First(e => e.Name == check.GetProperty("name").GetString());
                    var property = check.GetProperty("property").GetString()!;
                    var actual = Convert.ToString(target.GetType().GetProperty(property)!.GetValue(target), CultureInfo.InvariantCulture);
                    if (actual != check.GetProperty("value").GetString()) throw new InvalidOperationException($"{target.Name}.{property}: {actual}");
                }
                var image = new RenderTargetBitmap((int)Math.Ceiling(width), (int)Math.Ceiling(height), 96, 96, PixelFormats.Pbgra32);
                image.Render(view);
                var png = new PngBitmapEncoder();
                png.Frames.Add(BitmapFrame.Create(image));
                using (var stream = File.Create(Path.Combine(args[1], name + ".png"))) png.Save(stream);
                results.Add(new { name, success = true, geometryChecks = checks });
                Console.WriteLine($"PASS WPF {name}: parsed, measured, arranged, state-checked and rendered");
            }
            catch (Exception error)
            {
                results.Add(new { name, success = false, error = error.ToString() });
                Console.Error.WriteLine($"FAIL WPF {name}: {error}");
            }
        }
        File.WriteAllText(Path.Combine(args[1], "wpf.json"), JsonSerializer.Serialize(results, new JsonSerializerOptions { WriteIndented = true }));
        return results.Count == 0 || results.Any(item => !(bool)item.GetType().GetProperty("success")!.GetValue(item)!) ? 1 : 0;
    }

    private static IEnumerable<DependencyObject> Descendants(DependencyObject item)
    {
        yield return item;
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(item); i++)
            foreach (var child in Descendants(VisualTreeHelper.GetChild(item, i))) yield return child;
    }
}
