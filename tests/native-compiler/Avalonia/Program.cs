using System.IO;
using System.Globalization;
using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Markup.Xaml;
using Avalonia.Media.Imaging;
using Avalonia.Themes.Fluent;
using Avalonia.Threading;
using Avalonia.VisualTree;

public sealed class TestApp : Application
{
    public override void Initialize() => Styles.Add(new FluentTheme());
}
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 2) throw new ArgumentException("Provide fixture and report directories.");
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        Directory.CreateDirectory(args[1]);
        AppBuilder.Configure<TestApp>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }).SetupWithoutStarting();
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(args[0], "manifest.json")));
        var results = new List<object>();
        foreach (var fixture in manifest.RootElement.GetProperty("fixtures").EnumerateArray().Where(f => f.GetProperty("framework").GetString() == "Avalonia"))
        {
            var name = fixture.GetProperty("name").GetString()!;
            Window? window = null;
            try
            {
                var view = (Control)AvaloniaRuntimeXamlLoader.Load(File.ReadAllText(Path.Combine(args[0], fixture.GetProperty("file").GetString()!)));
                var width = fixture.GetProperty("width").GetDouble();
                var height = fixture.GetProperty("height").GetDouble();
                window = new Window { Content = view, Width = width, Height = height };
                window.Show();
                Dispatcher.UIThread.RunJobs();
                view.Measure(new Size(width, height));
                view.Arrange(new Rect(0, 0, width, height));
                var checks = 0;
                foreach (var check in fixture.GetProperty("checks").EnumerateArray())
                {
                    var target = view.GetSelfAndVisualDescendants().OfType<Control>().First(e => e.Name == check.GetProperty("name").GetString());
                    var origin = target.TranslatePoint(new Point(), view) ?? throw new InvalidOperationException("Detached native control");
                    foreach (var (property, actual) in new[] { ("width", target.Bounds.Width), ("height", target.Bounds.Height), ("x", origin.X), ("y", origin.Y) })
                    {
                        if (check.TryGetProperty(property, out var expected) && (!double.IsFinite(actual) || Math.Abs(actual - expected.GetDouble()) > 0.15))
                            throw new InvalidOperationException($"{target.Name}.{property}: actual {actual} expected {expected}");
                        if (check.TryGetProperty(property, out _)) checks++;
                    }
                }
                foreach (var check in fixture.GetProperty("text").EnumerateArray())
                {
                    var target = view.GetSelfAndVisualDescendants().OfType<Control>().First(e => e.Name == check.GetProperty("name").GetString());
                    var property = check.GetProperty("property").GetString()!;
                    var actual = Convert.ToString(target.GetType().GetProperty(property)!.GetValue(target), CultureInfo.InvariantCulture);
                    if (actual != check.GetProperty("value").GetString()) throw new InvalidOperationException($"{target.Name}.{property}: {actual}");
                }
                using var image = new RenderTargetBitmap(new PixelSize((int)Math.Ceiling(width), (int)Math.Ceiling(height)), new Vector(96, 96));
                image.Render(view);
                image.Save(Path.Combine(args[1], name + ".png"));
                results.Add(new { name, success = true, geometryChecks = checks });
                Console.WriteLine($"PASS Avalonia {name}: parsed, measured, arranged, state-checked and rendered");
            }
            catch (Exception error)
            {
                results.Add(new { name, success = false, error = error.ToString() });
                Console.Error.WriteLine($"FAIL Avalonia {name}: {error}");
            }
            finally { window?.Close(); Dispatcher.UIThread.RunJobs(); }
        }
        File.WriteAllText(Path.Combine(args[1], "avalonia.json"), JsonSerializer.Serialize(results, new JsonSerializerOptions { WriteIndented = true }));
        return results.Count == 0 || results.Any(item => !(bool)item.GetType().GetProperty("success")!.GetValue(item)!) ? 1 : 0;
    }
}
