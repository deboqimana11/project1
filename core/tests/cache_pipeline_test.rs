use reader_core::cache::{CacheEntry, MemoryCache};
use reader_core::codec::DecodedImage;
use reader_core::pipeline::mip::{MipChainConfig, build_chain};
use reader_core::pipeline::tile::{TileConfig, slice_vertical};
use reader_core::types::{CacheBudget, ImageDimensions, ImageKey, PageId, SourceId};

fn page(source: &str, index: u32) -> PageId {
    PageId { source_id: SourceId::new(source), index }
}

fn decoded(width: u32, height: u32, value: u8) -> DecodedImage {
    DecodedImage {
        dimensions: ImageDimensions { width, height },
        pixels: vec![value; (width * height * 4) as usize],
    }
}

#[test]
fn memory_cache_evicts_least_recently_used() {
    let mut cache = MemoryCache::new(CacheBudget { bytes_max: 64 });
    let key1 = ImageKey::new("entry::1");
    let key2 = ImageKey::new("entry::2");
    let key3 = ImageKey::new("entry::3");

    let page1 = page("src", 1);
    let page2 = page("src", 2);
    let page3 = page("src", 3);

    cache.insert(key1.clone(), CacheEntry::new(page1.clone(), vec![1; 32])).unwrap();
    cache.insert(key2.clone(), CacheEntry::new(page2.clone(), vec![2; 32])).unwrap();

    // Touch entry 1 so it becomes most recent.
    cache.get(&key1);

    cache.insert(key3.clone(), CacheEntry::new(page3.clone(), vec![3; 32])).unwrap();

    assert!(cache.get(&key1).is_some(), "recent entry should be retained");
    assert!(cache.get(&key2).is_none(), "least recently used entry should be evicted");
    assert!(cache.get(&key3).is_some());
    assert!(cache.bytes_used() <= 64);
}

#[test]
fn memory_cache_retain_validates_page_mapping() {
    let mut cache = MemoryCache::new(CacheBudget { bytes_max: 64 });
    let key = ImageKey::new("retain");
    let page_actual = page("src", 7);
    cache.insert(key.clone(), CacheEntry::new(page_actual.clone(), vec![5; 16])).unwrap();

    assert!(cache.retain(&key, &page_actual).unwrap());

    let wrong_page = page("src", 8);
    let err = cache.retain(&key, &wrong_page).expect_err("mismatched page should error");
    assert!(err.to_string().contains("mapped"));
}

#[test]
fn mip_chain_obeys_min_dimension() {
    let image = decoded(64, 40, 200);
    let base_key = ImageKey::new("mip::base");
    let config = MipChainConfig { min_dimension: 8, ..Default::default() };
    let chain = build_chain(&base_key, &image, config).expect("build chain");

    assert!(!chain.is_empty());
    let first = &chain.levels()[0];
    assert_eq!(first.dimensions, ImageDimensions { width: 32, height: 20 });
    let last = chain.levels().last().unwrap();
    assert!(last.dimensions.width >= 8);
    assert!(last.dimensions.height >= 8);
}

#[test]
fn tiling_produces_overlapping_slices() {
    let image = decoded(512, 4096, 90);
    let base_key = ImageKey::new("tile::base");
    let config = TileConfig { aspect_ratio_threshold: 3.0, max_tile_height: 1024, overlap: 128 };
    let tiles = slice_vertical(&image, &base_key, config).expect("slice vertical");

    assert!(tiles.len() > 1);
    assert_eq!(tiles[0].offset_y, 0);
    assert_eq!(tiles[0].image.dimensions.height, config.max_tile_height);
    assert_eq!(tiles[1].offset_y, config.max_tile_height - config.overlap);
    let last = tiles.last().unwrap();
    assert_eq!(last.offset_y + last.image.dimensions.height, image.height());
}
