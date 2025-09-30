//! Logging bootstrap utilities for the local comic reader.
//!
//! This module wires the `tracing` ecosystem together with a rolling file sink so the
//! application keeps a persistent, low-noise diagnostic trail. The public `init` function is
//! intended to be called once on startup (typically from the Tauri shell) and is safe to call
//! multiple times—subsequent calls simply return the already-installed logger handle.

use std::cmp::Ordering;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::SystemTime;

use anyhow::{Context, Result};
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, filter::LevelFilter, util::SubscriberInitExt};

const DEFAULT_ENV_FILTER_VARS: [&str; 2] = ["LOCAL_COMIC_READER_LOG", "RUST_LOG"];

/// Global log handle stored after the first successful initialisation.
static LOG_HANDLE: OnceLock<LogHandle> = OnceLock::new();

/// Re-export of the level filter type to avoid leaking `tracing-subscriber` to callers.
pub use tracing_subscriber::filter::LevelFilter as LogLevel;

/// Controls how the log file rolling behaviour works.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum LogRolling {
    /// Roll the log file every hour.
    Hourly,
    /// Roll the log file once per calendar day.
    Daily,
    /// Never roll automatically (single append-only file).
    Never,
}

impl LogRolling {
    fn to_rotation(self) -> tracing_appender::rolling::Rotation {
        match self {
            LogRolling::Hourly => tracing_appender::rolling::Rotation::HOURLY,
            LogRolling::Daily => tracing_appender::rolling::Rotation::DAILY,
            LogRolling::Never => tracing_appender::rolling::Rotation::NEVER,
        }
    }
}

/// Configuration for the logging system.
#[derive(Debug, Clone)]
pub struct LogConfig {
    /// Directory that will hold rolling log files.
    pub directory: PathBuf,
    /// File name prefix for generated log files (suffix is `.log`).
    pub file_prefix: String,
    /// Maximum number of rolled log files to keep. `None` disables pruning.
    pub retention: Option<usize>,
    /// Minimum level to emit to the rolling log file.
    pub file_level: LevelFilter,
    /// Minimum level to emit to the interactive console/stderr sink.
    pub console_level: LevelFilter,
    /// Whether to capture `log` crate records and forward them into `tracing`.
    pub capture_log: bool,
    /// Optional filter directive (e.g. `reader_core=debug,tauri=info`).
    pub env_filter: Option<String>,
    /// Rolling strategy used for the file sink.
    pub rolling: LogRolling,
}

impl Default for LogConfig {
    fn default() -> Self {
        let directory = default_log_directory();
        let file_prefix = "reader".to_string();
        let retention = Some(14);
        let file_level = LevelFilter::DEBUG;
        // Default to INFO in debug builds and WARN in release to reduce noise.
        let console_level =
            if cfg!(debug_assertions) { LevelFilter::INFO } else { LevelFilter::WARN };

        let env_filter = DEFAULT_ENV_FILTER_VARS
            .iter()
            .find_map(|var| std::env::var(var).ok())
            .filter(|directive| !directive.trim().is_empty());

        Self {
            directory,
            file_prefix,
            retention,
            file_level,
            console_level,
            capture_log: true,
            env_filter,
            rolling: LogRolling::Daily,
        }
    }
}

impl LogConfig {
    /// Convenience helper for overriding the log directory while retaining other defaults.
    pub fn with_directory<P: Into<PathBuf>>(mut self, path: P) -> Self {
        self.directory = path.into();
        self
    }

    /// Convenience helper for overriding the file prefix.
    pub fn with_prefix<S: Into<String>>(mut self, prefix: S) -> Self {
        self.file_prefix = prefix.into();
        self
    }
}

/// Handle returned from [`init`] that owns the background logging worker.
#[derive(Debug)]
pub struct LogHandle {
    _guard: tracing_appender::non_blocking::WorkerGuard,
    directory: PathBuf,
    file_prefix: String,
}

impl LogHandle {
    /// Returns the directory backing the rolling file sink.
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Returns the prefix applied to generated log files.
    pub fn file_prefix(&self) -> &str {
        &self.file_prefix
    }
}

/// Initialise the global logging subscriber.
///
/// Upon success the same [`LogHandle`] reference will be returned on subsequent calls. The first
/// invocation wins—later calls ignore their configuration arguments and simply hand back the
/// original handle.
pub fn init(config: LogConfig) -> Result<&'static LogHandle> {
    if let Some(handle) = LOG_HANDLE.get() {
        return Ok(handle);
    }

    let handle = setup(config)?;
    let _ = LOG_HANDLE.set(handle);
    Ok(LOG_HANDLE.get().expect("log handle initialised"))
}

fn setup(config: LogConfig) -> Result<LogHandle> {
    if config.capture_log {
        install_log_tracer(config.file_level, config.console_level)?;
    }

    fs::create_dir_all(&config.directory)
        .with_context(|| format!("creating log directory at {}", config.directory.display()))?;

    if let Some(retention) = config.retention.filter(|r| *r > 0) {
        prune_old_logs(&config.directory, &config.file_prefix, retention)
            .with_context(|| "applying log retention policy".to_string())?;
    }

    let rolling = tracing_appender::rolling::Builder::new()
        .rotation(config.rolling.to_rotation())
        .filename_prefix(&config.file_prefix)
        .filename_suffix("log")
        .build(config.directory.clone())
        .context("creating rolling log appender")?;

    let (file_writer, guard) = tracing_appender::non_blocking(rolling);

    let directive = config
        .env_filter
        .or_else(|| DEFAULT_ENV_FILTER_VARS.iter().find_map(|var| std::env::var(var).ok()))
        .filter(|directive| !directive.trim().is_empty())
        .unwrap_or_else(|| if cfg!(debug_assertions) { "debug" } else { "info" }.to_string());

    let env_filter = EnvFilter::try_new(directive).context("parsing env filter directive")?;

    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(file_writer)
        .with_file(true)
        .with_line_number(true)
        .with_filter(config.file_level);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_filter(config.console_level);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(console_layer)
        .try_init()
        .map_err(|err| anyhow::anyhow!(err))?;

    Ok(LogHandle { _guard: guard, directory: config.directory, file_prefix: config.file_prefix })
}

fn install_log_tracer(file_level: LevelFilter, console_level: LevelFilter) -> Result<()> {
    let max_level = match file_level.cmp(&console_level) {
        Ordering::Less => console_level,
        Ordering::Equal => console_level,
        Ordering::Greater => file_level,
    };

    let log_level = match max_level {
        LevelFilter::OFF => log::LevelFilter::Off,
        LevelFilter::ERROR => log::LevelFilter::Error,
        LevelFilter::WARN => log::LevelFilter::Warn,
        LevelFilter::INFO => log::LevelFilter::Info,
        LevelFilter::DEBUG => log::LevelFilter::Debug,
        LevelFilter::TRACE => log::LevelFilter::Trace,
    };

    let _ = tracing_log::LogTracer::builder().with_max_level(log_level).init();
    Ok(())
}

fn prune_old_logs(dir: &Path, prefix: &str, retention: usize) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .with_context(|| format!("reading log directory at {}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.metadata().map(|meta| meta.is_file()).unwrap_or(false))
        .filter(|entry| matches_prefix(&entry.path(), prefix))
        .filter_map(|entry| {
            let modified =
                entry.metadata().and_then(|meta| meta.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
            Some((entry.path(), modified))
        })
        .collect();

    if entries.len() <= retention {
        return Ok(());
    }

    entries.sort_by_key(|(_, modified)| *modified);
    let excess = entries.len().saturating_sub(retention);
    for (path, _) in entries.into_iter().take(excess) {
        let _ = fs::remove_file(&path);
    }

    Ok(())
}

fn matches_prefix(path: &Path, prefix: &str) -> bool {
    path.file_stem().and_then(OsStr::to_str).map(|stem| stem.starts_with(prefix)).unwrap_or(false)
}

fn default_log_directory() -> PathBuf {
    if let Some(dirs) =
        directories::ProjectDirs::from("com", "LocalComicReader", "local-comic-reader")
    {
        let mut path = dirs.data_dir().to_path_buf();
        path.push("logs");
        path
    } else {
        std::env::temp_dir().join("local-comic-reader-logs")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_is_idempotent() {
        let temp = tempfile::tempdir().expect("temp dir");
        let config =
            LogConfig::default().with_directory(temp.path().join("logs")).with_prefix("test-log");

        let first = init(config.clone()).expect("init once");
        assert!(first.directory().exists());

        let second = init(config).expect("init twice");
        assert!(std::ptr::eq(first, second));
    }
}
