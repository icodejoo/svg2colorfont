// 可调 brotli 质量的 woff2 编码器(纯 Rust ttf2woff2 → wasm)。
// 替代固定 q11 的 woff2-encoder:实测 q9 比 q11 快 ~20×、体积仅 +6%。glyf 字体(本引擎已全 glyf)。
use ttf2woff2::{encode, BrotliQuality};
use wasm_bindgen::prelude::*;

/// TTF(glyf)→ woff2,quality 0..=11(>11 夹到 11)。返回 woff2 字节。
#[wasm_bindgen]
pub fn ttf_to_woff2(data: &[u8], quality: u8) -> Result<Vec<u8>, JsError> {
    encode(data, BrotliQuality::from(quality)).map_err(|e| JsError::new(&format!("{e:?}")))
}
