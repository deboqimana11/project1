use std::sync::Arc;

use tauri::Runtime;
use tauri::http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE, HeaderValue};
use tauri::http::{Request, Response, StatusCode};

use crate::image_cache::ImageCache;

const SCHEME: &str = "asset";

pub fn register<R: Runtime>(
    builder: tauri::Builder<R>,
    cache: Arc<ImageCache>,
) -> tauri::Builder<R> {
    builder.register_uri_scheme_protocol(SCHEME, move |_ctx, request| {
        println!("[protocol] incoming request: {:?}", request.uri());
        handle_request(request, Arc::clone(&cache))
    })
}

fn handle_request(request: Request<Vec<u8>>, cache: Arc<ImageCache>) -> Response<Vec<u8>> {
    let uri = request.uri().clone();

    let scheme = uri.scheme_str().unwrap_or_default().to_string();
    let host = uri.host().unwrap_or_default().to_string();
    println!("[protocol] parsed scheme={}, host={}, path={}", scheme, host, uri.path());

    let expected_host = format!("{SCHEME}.localhost");
    let host_allowed = match scheme.as_str() {
        s if s == SCHEME => host.is_empty() || host == "localhost" || host == expected_host,
        "http" | "https" => host == expected_host,
        _ => false,
    };
    if !host_allowed {
        return not_found("Unsupported origin");
    }

    // Decode percent-encoded path first so inputs like `img%2Fdemo` work.
    let raw_path = uri.path().trim_start_matches('/');
    let decoded_path = percent_encoding::percent_decode_str(raw_path)
        .decode_utf8()
        .unwrap_or_else(|_| raw_path.into())
        .to_string();

    let Some(actual_key) = resolve_image_key(&decoded_path, &expected_host) else {
        return not_found("Missing key");
    };

    println!("[protocol] resolved key={}", actual_key);

    let cached = match cache.fetch(&actual_key) {
        Ok(Some(image)) => image,
        Ok(None) => return not_found("Missing resource"),
        Err(err) => return internal_error(&err),
    };
    println!("[protocol] serving key={}, bytes={}", actual_key, cached.bytes.len());
    success_response(cached.bytes, &cached.mime)
}

fn success_response(body: Vec<u8>, mimetype: &str) -> Response<Vec<u8>> {
    let ct = HeaderValue::from_str(mimetype)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    cors_response(StatusCode::OK, body, Some(ct))
}

fn not_found(message: &str) -> Response<Vec<u8>> {
    cors_response(
        StatusCode::NOT_FOUND,
        message.as_bytes().to_vec(),
        Some(HeaderValue::from_static("text/plain; charset=utf-8")),
    )
}

fn internal_error(message: &str) -> Response<Vec<u8>> {
    cors_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        message.as_bytes().to_vec(),
        Some(HeaderValue::from_static("text/plain; charset=utf-8")),
    )
}

fn cors_response(
    status: StatusCode,
    body: Vec<u8>,
    content_type: Option<HeaderValue>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder();
    builder = builder.status(status);

    if let Some(ct) = content_type {
        if let Some(headers) = builder.headers_mut() {
            headers.insert(CONTENT_TYPE, ct);
        }
    }

    if let Some(headers) = builder.headers_mut() {
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    }

    builder.body(body).unwrap_or_else(|_| {
        Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap()
    })
}

fn resolve_image_key(decoded_path: &str, expected_host: &str) -> Option<String> {
    let expected_host_with_slash = format!("{expected_host}/");
    let mut remainder = decoded_path.trim_start_matches('/');

    remainder = strip_all_prefixes(remainder, "asset://");
    remainder = strip_all_prefixes(remainder, "//");
    remainder = strip_all_prefixes(remainder, expected_host_with_slash.as_str());
    remainder = strip_all_prefixes(remainder, expected_host);
    remainder = strip_all_prefixes(remainder, "asset://");
    remainder = strip_all_prefixes(remainder, "//");
    remainder = strip_all_prefixes(remainder, "localhost/");
    remainder = remainder.trim_start_matches('/');

    let mut had_img_prefix = false;
    if let Some(stripped) = remainder.strip_prefix("img/") {
        remainder = stripped;
        had_img_prefix = true;
    }

    remainder = remainder.trim_start_matches('/');

    if !had_img_prefix || remainder.is_empty() { None } else { Some(remainder.to_string()) }
}

fn strip_all_prefixes<'a>(mut value: &'a str, prefix: &str) -> &'a str {
    if prefix.is_empty() {
        return value;
    }

    while let Some(stripped) = value.strip_prefix(prefix) {
        value = stripped;
    }

    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use reader_core::stats::StatsCollector;
    use std::sync::Arc;

    fn cache_with_entry(key: &str, bytes: &[u8], mime: &str) -> Arc<ImageCache> {
        let temp = tempfile::tempdir().unwrap();
        let stats = Arc::new(StatsCollector::new());
        let cache = ImageCache::with_root(temp.path().join("cache"), Arc::clone(&stats)).unwrap();
        cache.ensure_bytes(key, mime, || Ok(bytes.to_vec())).unwrap();
        Arc::new(cache)
    }

    #[test]
    fn resolve_key_from_convert_file_src_url() {
        let expected = "asset.localhost".to_string();
        let key = resolve_image_key("asset://localhost/img/src-1-page-0", &expected).unwrap();
        assert_eq!(key, "src-1-page-0");
    }

    #[test]
    fn resolve_key_from_nested_http_url() {
        let expected = "asset.localhost".to_string();
        let key =
            resolve_image_key("asset.localhost/asset://localhost/img/src-1-thumb-0-320", &expected)
                .unwrap();
        assert_eq!(key, "src-1-thumb-0-320");
    }

    #[test]
    fn serves_cached_bytes_for_http_requests() {
        let cache = cache_with_entry("src-1-page-0", b"hello", "image/png");
        let request = Request::builder()
            .uri("http://asset.localhost/asset%3A%2F%2Flocalhost%2Fimg%2Fsrc-1-page-0")
            .body(Vec::new())
            .unwrap();

        let response = handle_request(request, cache);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), &b"hello".to_vec());
        assert_eq!(response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(), "*");
    }

    #[test]
    fn serves_cached_bytes_for_asset_scheme_requests() {
        let cache = cache_with_entry("src-1-page-1", b"world", "image/png");
        let request =
            Request::builder().uri("asset://localhost/img/src-1-page-1").body(Vec::new()).unwrap();

        let response = handle_request(request, cache);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), &b"world".to_vec());
    }

    #[test]
    fn missing_entries_return_not_found_with_cors() {
        let temp = tempfile::tempdir().unwrap();
        let stats = Arc::new(StatsCollector::new());
        let cache =
            Arc::new(ImageCache::with_root(temp.path().join("cache"), Arc::clone(&stats)).unwrap());
        let request = Request::builder()
            .uri("http://asset.localhost/asset%3A%2F%2Flocalhost%2Fimg%2Fmissing")
            .body(Vec::new())
            .unwrap();

        let response = handle_request(request, cache);

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(), "*");
    }
}

fn resolve_namespace_and_key(decoded_path: &str, expected_host: &str) -> (String, String) {
    let expected_host_with_slash = format!("{expected_host}/");
    let mut remainder = decoded_path.trim_start_matches('/');

    if let Some(stripped) = remainder.strip_prefix("asset://") {
        remainder = stripped;
    }

    if let Some(stripped) = remainder.strip_prefix("//") {
        remainder = stripped;
    }

    if let Some(stripped) = remainder.strip_prefix(&expected_host_with_slash) {
        remainder = stripped;
    } else if let Some(stripped) = remainder.strip_prefix("localhost/") {
        remainder = stripped;
    }

    remainder = remainder.trim_start_matches('/');
    let mut segments = remainder.splitn(2, '/');
    let namespace = segments.next().unwrap_or_default().to_string();
    let key = segments.next().unwrap_or_default().to_string();
    (namespace, key)
}
