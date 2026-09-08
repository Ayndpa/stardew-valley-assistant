//! SMAPI 模组目录管理。
//!
//! 这里只放「给定 Mods 目录路径就能算出结果」的纯逻辑：manifest 的宽松 JSON 解析、
//! `{{i18n:Key}}` 占位符还原、模组文件夹扫描、以文件夹名前缀点号表示的启用/禁用规则，
//! 以及防路径穿越的文件夹名校验。所有入口都显式接收路径，不做游戏目录探测，
//! 桌面端与手机端因此可以共用同一套语义。

pub mod local;
pub mod model;

pub use model::{Mod, ModConfigField, ModProfile, ModStateEntry};
