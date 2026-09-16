/** WebGPU draws the infinite-canvas dot grid. DOM supplies accessible text/control layout. */
export class GridSurface {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'CSS';
    this.device = null;
    this.lost = false;
  }
  async init() {
    try {
      if (!navigator.gpu) return false;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      this.context = this.canvas.getContext('webgpu');
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device: this.device, format, alphaMode: 'premultiplied' });
      const module = this.device.createShaderModule({
        code: `struct Uniforms { size: vec2f, offset: vec2f, scale: f32, dark: f32, pad: vec2f }; @group(0) @binding(0) var<uniform> u: Uniforms;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1); }
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {let spacing=max(8.0,20.0*u.scale);let q=(p.xy-u.offset)/spacing;let d=length((fract(q+0.5)-0.5)*spacing);let a=1.0-smoothstep(0.6,1.1,d);let light=mix(vec3f(0.925,0.925,0.945),vec3f(0.75,0.75,0.80),a);let dark=mix(vec3f(0.105,0.11,0.14),vec3f(0.22,0.23,0.28),a);return vec4f(mix(light,dark,u.dark),1);}`,
      });
      this.pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.uniform = this.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.bind = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniform } }],
      });
      this.device.lost.then(() => {
        this.lost = true;
        this.mode = 'CSS';
        this.canvas.style.display = 'none';
      });
      this.mode = 'WebGPU';
      return true;
    } catch (error) {
      this.mode = 'CSS';
      this.canvas.style.display = 'none';
      return false;
    }
  }
  draw({ zoom = 1, panX = 0, panY = 0, dark = false } = {}) {
    if (!this.device || this.lost) return;
    const ratio = devicePixelRatio || 1,
      w = Math.max(1, Math.round(this.canvas.clientWidth * ratio)),
      h = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.device.queue.writeBuffer(
      this.uniform,
      0,
      new Float32Array([w, h, panX * ratio, panY * ratio, zoom * ratio, dark ? 1 : 0, 0, 0]),
    );
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
  dispose() {
    this.uniform?.destroy();
    this.device?.destroy();
  }
}
