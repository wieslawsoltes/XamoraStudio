# Xamora motion and appearance workflows

## Try the motion example

Open the command palette with Ctrl/Command+K, choose **Open motion example**, then open **Motion**. The example has an Entrance Storyboard, a gradient-ready vector shape, a reusable button style, a native Loaded trigger, a replay button and visual states. Use **Run preview** to execute its native event triggers and pointer states.

## Author an animation

1. Choose Motion and create a named Storyboard.
2. Select a control, add a property track; the editor infers its value type. Property paths can target transforms and brush colors as well as direct properties.
3. Add a starting key at zero and another key later in the timeline.
4. Drag keys to retime them; open a key to edit its value and interpolation. The key at the end of a segment owns that segment's interpolation.
5. Scrub or play. Stop restores the authored base presentation.
6. Enable Record to turn supported property-inspector edits into keys at the current playhead. In 0.5, supported canvas movement, resizing and rotation also record keys; text/path edits and unsupported channels remain ordinary authored edits.

Timing controls edit native Duration, BeginTime, RepeatBehavior, SpeedRatio, AutoReverse and FillBehavior. Times serialize as h:mm:ss with fractional seconds. The preview loop is a preview preference; RepeatBehavior is authored XAML. Infinite Storyboards use a finite timeline inspection window.

Numeric, color, point and thickness keys support linear, discrete, spline and easing interpolation. Object/Boolean keys are discrete. For unsupported animation types, property converters or clock features, review diagnostics and edit the preserved XAML directly.

## Visual states

Select the intended state owner and open Visual states. Create a group and states such as Normal, MouseOver and Pressed. Add a state property value or open that state's Storyboard in the timeline. State values are authored as zero-time animations.

Add transitions with From/To filters and a duration. Preview states from the state editor or connect a go-to-state action in the Flow panel. Groups coexist; selecting another state in the same group replaces the previous state. Empty states return animated properties to their underlying values.

Built-in pointer/focus mappings drive matching preview state names. A real custom control may implement a different state contract; verify it in the native framework.

## Event triggers and prototype actions

Native WPF event authoring adds EventTrigger with BeginStoryboard referencing a named resource. Use unique BeginStoryboard names if you want native Stop/Pause/Resume actions to address the clock.

The Flow editor also provides start Storyboard, stop Storyboard and go-to-state actions. These join navigation and data actions in a transactional sequence: a rejected later step rolls back the queued motion action as well as other session changes.

A preview session owns its clocks, state, data and overrides. Closing or resetting the preview disposes its clocks. Returning to a view creates a new activation. Saved XAML and the design database are not updated by preview playback.

## Appearance, styles and vectors

Select an object and use the Appearance & behavior controls in the Design inspector:

- **Brushes:** select Background/Foreground/Fill/Stroke/BorderBrush; edit solid, linear or radial brush data and gradient stops.
- **Transforms:** edit scale, skew, rotation, translation and origin while retaining existing transform order.
- **Effects & clip:** author blur, drop shadow and rectangular clipping.
- **Style & triggers:** edit reusable scalar setters and simple property triggers. Data and multi triggers can be authored in XAML and are evaluated by the preview. Local values override styles; removing matching local values is an explicit option. Advanced object setters and imported trigger structures remain editable in XAML.
- **Design values:** edit d: values, including ItemsSource sample data, without changing runtime properties.
- **Edit path:** move endpoints and curve handles, add pen points, close a figure and convert supported shapes.
- **Reset layout:** remove local layout overrides in one undoable edit.

The browser renderer approximates native brushes, effects and layout. Style/Storyboard/state/trigger authoring in this release targets WPF. Do not treat framework switching as automatic semantic conversion of these structures.

## Source and extension APIs

New reusable services are exported from core/index.js. The DOM-free animation, property-path, styling, state and vector modules can be used independently of the Studio. motion-render.js and the Studio runtime bridge require a DOM renderer. See ARCHITECTURE.md and EXTENDING.md for module contracts and limits.

## Inline authoring in 0.5

The timeline adds a quick name/duration/property strip, key inspector, multiple-key selection, group dragging, frame snapping, timeline zoom, duplicate/copy/paste and keyboard nudging. Editing a value preserves existing curve metadata; moving/pasting rejects collisions atomically. Recording respects supported nested clock timing and keeps authored base values separate. For gestures, local-time ruler limitations and current framework scope, read [Editor workflows](EDITOR-WORKFLOWS.md).
