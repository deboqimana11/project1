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
    if scheme != SCHEME && !(matches!(scheme.as_str(), "http" | "https") && host == expected_host) {
        return not_found("Unsupported scheme");
    }

    // Decode percent-encoded path first so inputs like `img%2Fdemo` work.
    let raw_path = uri.path().trim_start_matches('/');
    let decoded_path = percent_encoding::percent_decode_str(raw_path)
        .decode_utf8()
        .unwrap_or_else(|_| raw_path.into())
        .to_string();

    let (namespace, key) = resolve_namespace_and_key(&decoded_path, &expected_host);

    println!("[protocol] resolved namespace={}, key={}", namespace, key);

    if namespace != "img" && namespace != "localhost" {
        return not_found("Unsupported namespace");
    }

    let actual_key = if namespace == "localhost" {
        if key.is_empty() {
            return not_found("Missing key");
        }
        key
    } else {
        if key.is_empty() {
            return not_found("Missing key");
        }
        if host != expected_host {
            return not_found("Unsupported host");
        }
        key
    };

    let cached = match cache.fetch(&actual_key) {
        Ok(Some(image)) => image,
        Ok(None) => return not_found("Missing resource"),
        Err(err) => return internal_error(&err),
    };
    println!(
        "[protocol] serving namespace={}, key={}, bytes={}",
        namespace,
        actual_key,
        cached.bytes.len()
    );
    success_response(cached.bytes, &cached.mime)
}

fn success_response(body: Vec<u8>, mimetype: &str) -> Response<Vec<u8>> {
    let ct = HeaderValue::from_str(mimetype)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, ct)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"))
        .body(body)
        .unwrap_or_else(|_| {
            Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap()
        })
}

fn not_found(message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| {
            Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap()
        })
}

fn internal_error(message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| {
            Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap()
        })
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
