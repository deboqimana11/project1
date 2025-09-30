//! Placeholder ComicInfo.xml parser entry point.

use crate::types::SeriesMeta;

use super::Result;

pub fn parse_bytes(_bytes: &[u8]) -> Result<SeriesMeta> {
    Ok(SeriesMeta::default())
}
