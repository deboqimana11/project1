mod commands;
mod image_cache;
mod protocol;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::Arc;

    let mut log_config = reader_core::log::LogConfig::default();
    if cfg!(debug_assertions) {
        log_config.console_level = reader_core::log::LogLevel::DEBUG;
    }

    if let Err(err) = reader_core::log::init(log_config) {
        eprintln!("failed to initialise logging: {err:#}");
    }

    let stats = Arc::new(reader_core::stats::StatsCollector::new());
    let cache = Arc::new(
        image_cache::ImageCache::new(Arc::clone(&stats)).expect("failed to initialise image cache"),
    );

    if cfg!(debug_assertions) {
        tracing::info!(path = %cache.root().display(), "image cache ready");
    }

    let builder = tauri::Builder::default();
    let builder = builder.plugin(tauri_plugin_dialog::init());
    let builder = protocol::register(builder, Arc::clone(&cache));
    let builder = commands::register(builder, Arc::clone(&cache), Arc::clone(&stats));

    builder.run(tauri::generate_context!()).expect("error while running tauri application");
}
