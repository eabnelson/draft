struct Glass {
    pass_info: vec4f, // pass size, pass origin (physical pixels)
    rect: vec4f,
    lobes: vec4f, // three lobe widths in points, pixels per point
    tint: vec4f,
    clip: vec4f,
    fade: vec4u,
    flags: vec4f,
    region: vec4f, // padded crop in source pixels
    blur_size: vec4f,
}
@group(0) @binding(0) var<uniform> g: Glass;
@group(0) @binding(1) var backdrop: texture_2d<f32>;
@group(0) @binding(2) var linear_sampler: sampler;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let corners = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
    let p = g.rect.xy + corners[i] * g.rect.zw - g.pass_info.zw;
    return vec4f(p / g.pass_info.xy * vec2f(2,-2) + vec2f(-1,1), 0, 1);
}
@vertex fn vs_blur(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let corners = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
    return vec4f(corners[i] * vec2f(2,-2) + vec2f(-1,1),0,1);
}
fn gaussian(uv: vec2f, step: vec2f) -> vec4f {
    var result = vec4f(0);
    var total = 0.0;
    for (var i = -12; i <= 12; i++) {
        let weight = exp(-f32(i*i) / 32.0);
        result += textureSampleLevel(backdrop,linear_sampler,uv + f32(i)*step,0) * weight;
        total += weight;
    }
    return result / total;
}
@fragment fn fs_horizontal(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let size = vec2f(textureDimensions(backdrop));
    let uv = (g.region.xy + pos.xy / g.blur_size.xy * g.region.zw) / size;
    return gaussian(uv,vec2f(g.lobes.w / size.x,0));
}
@fragment fn fs_vertical(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    return gaussian(pos.xy / g.blur_size.xy,vec2f(0,g.lobes.w / g.region.w));
}

fn box_distance(p: vec2f, half: vec2f) -> f32 {
    let q = abs(p) - half;
    return length(max(q, vec2f(0))) + min(max(q.x, q.y), 0.0);
}
fn contour(p: vec2f) -> f32 {
    var distance = 100000.0;
    var x = 0.0;
    for (var i = 0u; i < 3u; i++) {
        let width = g.lobes[i];
        if width <= 0.0 { break; }
        // The same 7pt corners and 5.25pt scoops as design::pill_paths.
        let half = vec2f(width * 0.5, 14.0);
        distance = min(distance, box_distance(p - vec2f(x + half.x,14), half - vec2f(7)) - 7.0);
        x += width;
        if i < 2u && g.lobes[i + 1u] > 0.0 {
            let center = x + 2.625;
            // Extend into both lobes to prevent a seam at the joins.
            let bridge = box_distance(p - vec2f(center,14), vec2f(9.625,7));
            let scoop = max(2.625 - length(p - vec2f(center,7)), 2.625 - length(p - vec2f(center,21)));
            distance = min(distance, max(bridge, scoop));
            x += 5.25;
        }
    }
    return distance;
}
fn srgb(c: vec3f) -> vec3f {
    return select(1.055 * pow(max(c,vec3f(0)),vec3f(1.0/2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let window = pos.xy + g.pass_info.zw;
    let coverage = clamp(0.5 - contour((window - g.rect.xy) / g.lobes.w) * g.lobes.w, 0.0, 1.0)
        * clip_alpha(window, g.clip, g.fade);
    if coverage <= 0.0 { discard; }
    let blurred = textureSampleLevel(backdrop,linear_sampler,(pos.xy - g.region.xy) / g.region.zw,0);
    var tint = g.tint.rgb;
    if g.flags.x > 0.5 { tint = srgb(tint); }
    // Replace the sharp source within the contour, including on a translucent window.
    let color = mix(blurred.rgb / max(blurred.a,0.001),tint,g.tint.a);
    return vec4f(color * coverage,coverage);
}
