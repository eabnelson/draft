//! Backdrop frost clipped to Draft's joined tab contour, rather than a header strip.
use super::*;
use rune::compose::{Compositor, DeviceKey, Frame};
use rune::render::{EffectPhase, EffectSite};

pub const TAB: u32 = 0x44524146;
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniform {
    target: [f32; 4],
    rect: [f32; 4],
    lobes: [f32; 4],
    tint: [f32; 4],
    clip: [f32; 4],
    fade: [u32; 4],
    flags: [f32; 4],
    region: [f32; 4],
    blur_size: [f32; 4],
}
struct Pipeline {
    pipeline: wgpu::RenderPipeline,
    horizontal: wgpu::RenderPipeline,
    vertical: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}
impl Pipeline {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Draft tab frost"),
            source: wgpu::ShaderSource::Wgsl(
                format!(
                    "{}\n{}",
                    rune::render::CLIP_WGSL,
                    include_str!("glass.wgsl")
                )
                .into(),
            ),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Tab frost"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Tab frost"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let make_pipeline = |vertex, fragment, format, blend| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Tab frost"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some(vertex),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(fragment),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let pipeline = make_pipeline(
            "vs",
            "fs",
            format,
            Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
        );
        let horizontal = make_pipeline(
            "vs_blur",
            "fs_horizontal",
            wgpu::TextureFormat::Rgba16Float,
            None,
        );
        let vertical = make_pipeline(
            "vs_blur",
            "fs_vertical",
            wgpu::TextureFormat::Rgba16Float,
            None,
        );
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            pipeline,
            horizontal,
            vertical,
            layout,
            sampler,
        }
    }
}
struct Slot {
    uniform: wgpu::Buffer,
    bindings: Option<wgpu::BindGroup>,
    scratch: Option<Scratch>,
}
struct Scratch {
    size: [u32; 2],
    horizontal: wgpu::TextureView,
    vertical: wgpu::TextureView,
}
impl Scratch {
    fn new(device: &wgpu::Device, size: [u32; 2]) -> Self {
        let texture = || {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some("Tab frost crop"),
                    size: wgpu::Extent3d {
                        width: size[0],
                        height: size[1],
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba16Float,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING
                        | wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        Self {
            size,
            horizontal: texture(),
            vertical: texture(),
        }
    }
}
fn bindings(
    device: &wgpu::Device,
    pipeline: &Pipeline,
    buffer: &wgpu::Buffer,
    texture: &wgpu::TextureView,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Tab frost"),
        layout: &pipeline.layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(texture),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Sampler(&pipeline.sampler),
            },
        ],
    })
}
fn blur_pass(
    encoder: &mut wgpu::CommandEncoder,
    target: &wgpu::TextureView,
    pipeline: &wgpu::RenderPipeline,
    bindings: &wgpu::BindGroup,
) {
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("Tab frost blur"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view: target,
            depth_slice: None,
            resolve_target: None,
            ops: wgpu::Operations {
                load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                store: wgpu::StoreOp::Store,
            },
        })],
        ..Default::default()
    });
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, bindings, &[]);
    pass.draw(0..6, 0..1);
}
#[derive(Default)]
pub struct Glass {
    device: Option<DeviceKey>,
    pipelines: HashMap<wgpu::TextureFormat, Pipeline>,
    slots: HashMap<u32, Slot>,
}
impl Compositor<State> for Glass {
    fn render(&mut self, f: &mut Frame<'_, State>) {
        if self.device != Some(f.device_key()) {
            self.pipelines.clear();
            self.slots.clear();
            self.device = Some(f.device_key());
        }
        let mut seen = std::collections::HashSet::new();
        let clear = f.rt.clear_color();
        f.ui.prepare(
            f.device,
            f.queue,
            &mut f.rt.text.atlas,
            &f.rt.instances,
            f.size,
        );
        f.ui.draw_with_backdrop(
            f.encoder,
            f.target,
            clear,
            &mut |phase, site: &EffectSite<'_>| {
                if site.mark != TAB {
                    return;
                }
                match phase {
                    EffectPhase::Backdrop(encoder) => {
                        let Some(backdrop) = site.backdrop else {
                            return;
                        };
                        seen.insert(site.index);
                        let pipeline = self
                            .pipelines
                            .entry(site.format)
                            .or_insert_with(|| Pipeline::new(f.device, site.format));
                        let slot = self.slots.entry(site.index).or_insert_with(|| Slot {
                            uniform: f.device.create_buffer(&wgpu::BufferDescriptor {
                                label: Some("Tab frost"),
                                size: std::mem::size_of::<Uniform>() as u64,
                                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                                mapped_at_creation: false,
                            }),
                            bindings: None,
                            scratch: None,
                        });
                        let p = design::Palette::new(site.data[3] > 0.5);
                        let pad = 16.0 * site.scale;
                        let [x, y, w, h] = site.instance.rect;
                        let region = [
                            x - site.origin[0] - pad,
                            y - site.origin[1] - pad,
                            w + 2.0 * pad,
                            h + 2.0 * pad,
                        ];
                        let size = [
                            (region[2] / 2.0).ceil().max(1.0) as u32,
                            (region[3] / 2.0).ceil().max(1.0) as u32,
                        ];
                        if slot.scratch.as_ref().is_none_or(|s| s.size != size) {
                            slot.scratch = Some(Scratch::new(f.device, size));
                        }
                        let scratch = slot.scratch.as_ref().unwrap();
                        let uniform = Uniform {
                            target: [
                                site.size[0] as f32,
                                site.size[1] as f32,
                                site.origin[0],
                                site.origin[1],
                            ],
                            rect: site.instance.rect,
                            lobes: [site.data[0], site.data[1], site.data[2], site.scale],
                            tint: [p.background.r, p.background.g, p.background.b, 0.38],
                            clip: site.instance.clip,
                            fade: site.instance.fade,
                            flags: [if site.srgb_blend { 1.0 } else { 0.0 }, 0.0, 0.0, 0.0],
                            region,
                            blur_size: [size[0] as f32, size[1] as f32, 0.0, 0.0],
                        };
                        f.queue
                            .write_buffer(&slot.uniform, 0, bytemuck::bytes_of(&uniform));
                        let horizontal = bindings(f.device, pipeline, &slot.uniform, backdrop);
                        let vertical =
                            bindings(f.device, pipeline, &slot.uniform, &scratch.horizontal);
                        blur_pass(
                            encoder,
                            &scratch.horizontal,
                            &pipeline.horizontal,
                            &horizontal,
                        );
                        blur_pass(encoder, &scratch.vertical, &pipeline.vertical, &vertical);
                        slot.bindings = Some(bindings(
                            f.device,
                            pipeline,
                            &slot.uniform,
                            &scratch.vertical,
                        ));
                    }
                    EffectPhase::Draw(pass) => {
                        if let (Some(pipeline), Some(slot)) = (
                            self.pipelines.get(&site.format),
                            self.slots.get(&site.index),
                        ) && let Some(bindings) = &slot.bindings
                        {
                            pass.set_pipeline(&pipeline.pipeline);
                            pass.set_bind_group(0, bindings, &[]);
                            pass.draw(0..6, 0..1);
                        }
                    }
                }
            },
        );
        self.slots.retain(|index, _| seen.contains(index));
    }
}

pub fn frost(widths: &[f32], dark: bool) -> El {
    let width = widths.iter().sum::<f32>() + 5.25 * widths.len().saturating_sub(1) as f32;
    el().size(width, 28.0)
        .absolute(0.0, 0.0)
        .effect(TAB)
        .effect_backdrop(true)
        .effect_data([
            widths[0],
            *widths.get(1).unwrap_or(&0.0),
            *widths.get(2).unwrap_or(&0.0),
            if dark { 1.0 } else { 0.0 },
        ])
}
