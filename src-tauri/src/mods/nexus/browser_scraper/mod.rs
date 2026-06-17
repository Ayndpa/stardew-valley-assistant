mod download_url;
mod files_tab;
mod metadata;
mod scraper;

use std::sync::atomic::AtomicU64;
use std::sync::OnceLock;

pub(crate) static DOWNLOAD_COUNTER: OnceLock<AtomicU64> = OnceLock::new();

pub use scraper::{close_scraper_window, open_scraper_window};

pub(crate) use download_url::fetch_nexus_download_url_via_browser;
pub(crate) use files_tab::resolve_nexus_download_params_from_files_tab_widget;
pub(crate) use metadata::fetch_nexus_download_metadata_via_browser;
