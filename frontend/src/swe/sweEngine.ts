// P0-3 WebGPU SWE engine shell: buffers, dispatch loop, readback, self-tests.
import { SIM_WGSL } from './sweShaders'
import type { SweMesh } from './sweAssets'

export interface SweStats {
  totalWaterM3: number
  wetKm2: number
  wet05Km2?: number
  wet15Km2?: number
  maxDepthM: number
  maxSpeedMs: number
  p90DepthM?: number
  simSeconds: number
}

const SIM_SECONDS_PER_STEP = 1.0 // 1 sim second per solver step (dt=1 s)

export class SweEngine {
  mesh: SweMesh
  device: GPUDevice
  private statesBuf!: GPUBuffer
  private bedBuf!: GPUBuffer
  private roughBuf!: GPUBuffer
  private invABuf!: GPUBuffer
  private edgeBuf!: GPUBuffer
  private nbBuf!: GPUBuffer
  private uniBuf!: GPUBuffer
  private pipeline!: GPUComputePipeline
  private staging!: GPUBuffer
  private parity = 0
  simTime = 0
  params = { g: 9.81, dt: 1.0, rainMmH: 0, hDry: 1e-4, drainOn: false, drainScale: 1 }

  private constructor(mesh: SweMesh, device: GPUDevice) {
    this.mesh = mesh
    this.device = device
  }

  static async create(mesh: SweMesh): Promise<SweEngine> {
    const gpu = navigator.gpu
    if (!gpu) throw new Error('WebGPU 不可用：请用最新 Chrome/Edge（或开启 Safari 17+ 实验特性）')
    const adapter = await gpu.requestAdapter()
    if (!adapter) throw new Error('无可用 GPU adapter')
    const device = await adapter.requestDevice()
    const eng = new SweEngine(mesh, device)
    eng.build()
    return eng
  }

  private build() {
    const { M, bed, rough, invArea, edgeGeo, nb } = this.mesh
    const d = this.device
    const nBytes = (n: number) => Math.max(4, Math.ceil(n / 4) * 4)
    // states: 2*M vec4f ping-pong (CPU-init via writeBuffer needs COPY_DST)
    this.statesBuf = d.createBuffer({ size: 2 * M * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
    this.drainBuf = d.createBuffer({ size: M * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    const bedArr = new Float32Array(bed.length); bedArr.set(bed)
    const roughArr = new Float32Array(rough.length); roughArr.set(rough)
    const invAArr = new Float32Array(invArea.length); invAArr.set(invArea)
    const edgeArr = new Float32Array(edgeGeo.length); edgeArr.set(edgeGeo)
    const nbArr = new Int32Array(nb.length); nbArr.set(nb)
    this.bedBuf = this.upload(new Uint8Array(bedArr.buffer), M * 4)
    this.roughBuf = this.upload(new Uint8Array(roughArr.buffer), M * 4)
    this.invABuf = this.upload(new Uint8Array(invAArr.buffer), M * 4)
    this.edgeBuf = this.upload(new Uint8Array(edgeArr.buffer), 3 * M * 16)
    d.queue.writeBuffer(this.drainBuf, 0, this.mesh.drainK)
    this.nbBuf = this.upload(new Uint8Array(nbArr.buffer), 3 * M * 4)
    this.uniBuf0 = d.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.uniBuf1 = d.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.staging = d.createBuffer({ size: M * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })

    const layout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    })
    const uniLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }],
    })
    this.pipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [layout, uniLayout] }),
      compute: { module: d.createShaderModule({ code: SIM_WGSL }), entryPoint: 'main' },
    })
    this.bg = d.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.statesBuf } },
        { binding: 1, resource: { buffer: this.bedBuf } },
        { binding: 2, resource: { buffer: this.roughBuf } },
        { binding: 3, resource: { buffer: this.invABuf } },
        { binding: 4, resource: { buffer: this.edgeBuf } },
        { binding: 5, resource: { buffer: this.nbBuf } },
        { binding: 6, resource: { buffer: this.drainBuf } },
      ],
    })
    this.bgU0 = d.createBindGroup({ layout: uniLayout, entries: [{ binding: 0, resource: { buffer: this.uniBuf0 } }] })
    this.bgU1 = d.createBindGroup({ layout: uniLayout, entries: [{ binding: 0, resource: { buffer: this.uniBuf1 } }] })
    this.refreshUniforms()
  }

  private bg!: GPUBindGroup
  private uniBuf0!: GPUBuffer
  private uniBuf1!: GPUBuffer
  private bgU0!: GPUBindGroup
  private bgU1!: GPUBindGroup

  private upload(bytes: Uint8Array, size: number): GPUBuffer {
    const b = this.device.createBuffer({
      size: Math.max(size, bytes.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(b, 0, bytes)
    return b
  }

  /** write uniform block (layout matches WGSL SimParams, padded to 64 bytes) */
  private writeUniform(parity: number): ArrayBuffer {
    const p = this.params
    const buf = new ArrayBuffer(64)
    const f = new Float32Array(buf)
    f[0] = p.g; f[1] = p.dt; f[2] = p.rainMmH / 3.6e6; f[3] = p.hDry
    f[4] = p.drainOn ? 1 : 0; f[5] = p.drainScale
    const u = new Uint32Array(buf)
    u[8] = parity >>> 0      // parity at byte offset 32 (after 8 f32 fields)
    u[9] = this.mesh.M >>> 0 // n_tri at byte offset 36
    return buf
  }

  /** refresh both parity uniform buffers from the current params */
  refreshUniforms() {
    const d = this.device
    d.queue.writeBuffer(this.uniBuf0, 0, this.writeUniform(0))
    d.queue.writeBuffer(this.uniBuf1, 0, this.writeUniform(1))
  }

  /** run n sub-steps of the solver (double-buffered parity via two uniform groups) */
  step(n = 1) {
    const enc = this.device.createCommandEncoder()
    for (let i = 0; i < n; i++) {
      const pass = enc.beginComputePass()
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, this.bg)
      pass.setBindGroup(1, this.parity ? this.bgU1 : this.bgU0)
      pass.dispatchWorkgroups(Math.ceil(this.mesh.M / 64))
      pass.end()
      this.parity = 1 - this.parity
    }
    this.device.queue.submit([enc.finish()])
    this.simTime += n * SIM_SECONDS_PER_STEP
  }

  /** init state: eta = eta0 everywhere (flat water surface, at rest on real terrain) */
  initConstEta(eta0 = 3.0) {
    const { M } = this.mesh
    const a = new Float32Array(2 * M * 4)
    for (let t = 0; t < M; t++) {
      a[t * 4] = eta0
      a[(M + t) * 4] = eta0
    }
    this.device.queue.writeBuffer(this.statesBuf, 0, a)
    this.parity = 0
    this.simTime = 0
  }

  /** init dry state (eta = bed everywhere) */
  initDry() {
    const { M, bed } = this.mesh
    const a = new Float32Array(2 * M * 4)
    for (let t = 0; t < M; t++) {
      const v = bed[t]
      a[t * 4] = v; a[(M + t) * 4] = v
    }
    this.device.queue.writeBuffer(this.statesBuf, 0, a)
    this.parity = 0
    this.simTime = 0
  }

  /** copy current write-half state back to CPU (serialised: one map at a time) */
  private readChain: Promise<unknown> = Promise.resolve()
  async readState(): Promise<Float32Array> {
    const run = async (): Promise<Float32Array> => {
      const wr = this.parity === 1 ? 0 : 1 // read from the half last written
      const src = wr === 0 ? 0 : this.mesh.M * 16
      const enc = this.device.createCommandEncoder()
      enc.copyBufferToBuffer(this.statesBuf, src, this.staging, 0, this.mesh.M * 16)
      this.device.queue.submit([enc.finish()])
      await this.staging.mapAsync(GPUMapMode.READ)
      const out = new Float32Array(this.staging.getMappedRange().slice(0))
      this.staging.unmap()
      return out
    }
    const p = this.readChain.then(run, run)
    this.readChain = p.then(() => undefined, () => undefined)
    return p
  }

  /** aggregate stats from a CPU state snapshot */
  statsFrom(state: Float32Array): SweStats {
    const { M, bed, area } = this.mesh
    let vol = 0, wetA = 0, wet05 = 0, wet15 = 0, maxD = 0, maxS = 0
    let n = 0, acc = 0
    const hs: number[] = []
    for (let t = 0; t < M; t++) {
      const e = state[t * 4], hu = state[t * 4 + 1], hv = state[t * 4 + 2]
      const h = e - bed[t]
      if (h > 0) {
        const A = area[t]
        vol += h * A
        wetA += A
        if (h > 0.05) wet05 += A
        if (h > 0.15) wet15 += A
        if (h > maxD) maxD = h
        const s = Math.hypot(hu, hv) / Math.max(h, 1e-6)
        if (s > maxS) maxS = s
        if (h > 0.001 && (n % 4 === 0)) { hs.push(h); n++ } // stratified sample for p90
      }
      n++
    }
    hs.sort((a, b) => a - b)
    const p90 = hs.length ? hs[Math.floor(hs.length * 0.9)] : 0
    void acc
    return { totalWaterM3: vol, wetKm2: wetA / 1e6, wet05Km2: wet05 / 1e6, wet15Km2: wet15 / 1e6, maxDepthM: maxD, maxSpeedMs: maxS, p90DepthM: p90, simSeconds: this.simTime }
  }

  /** well-balanced self-test: flat water surface (eta=const) over real terrain stays at rest */
  async selfTestLake(steps = 200): Promise<{ maxEtaDriftM: number; maxSpeed: number; totalM3: number }> {
    const ETA0 = 3.0
    this.initConstEta(ETA0)
    this.params.rainMmH = 0
    this.params.drainOn = false
    this.refreshUniforms()
    this.step(steps)
    const s = await this.readState()
    const { M } = this.mesh
    let maxDrift = 0, maxS = 0
    for (let t = 0; t < M; t++) {
      const e = s[t * 4], hu = s[t * 4 + 1], hv = s[t * 4 + 2]
      // measure only cells wet at rest (bed below the lake surface)
      if (this.mesh.bed[t] >= ETA0) continue
      const drift = Math.abs(e - ETA0)
      if (drift > maxDrift) maxDrift = drift
      const h = e - this.mesh.bed[t]
      const sp = Math.hypot(hu, hv) / Math.max(h, 1e-6)
      if (sp > maxS) maxS = sp
    }
    return { maxEtaDriftM: maxDrift, maxSpeed: maxS, totalM3: this.statsFrom(s).totalWaterM3 }
  }
}
