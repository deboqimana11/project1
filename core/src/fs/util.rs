use std::cmp::Ordering;
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

/// Supported image file extensions (lowercase, without the dot).
pub const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"];

pub fn is_hidden(path: &Path) -> bool {
    path.file_name().and_then(OsStr::to_str).map(|name| name.starts_with('.')).unwrap_or(false)
}

pub fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            IMAGE_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

pub fn natural_cmp_path(a: &Path, b: &Path) -> Ordering {
    natural_cmp(&to_cmp_key(a), &to_cmp_key(b))
}

fn to_cmp_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let a_tokens = tokenize(a);
    let b_tokens = tokenize(b);

    for (a_tok, b_tok) in a_tokens.iter().zip(b_tokens.iter()) {
        match (a_tok, b_tok) {
            (Token::Number(a_digits, a_val), Token::Number(b_digits, b_val)) => {
                match a_val.cmp(b_val) {
                    Ordering::Equal => match a_digits.len().cmp(&b_digits.len()) {
                        Ordering::Equal => {}
                        other => return other,
                    },
                    other => return other,
                }
            }
            (Token::Text(a_text), Token::Text(b_text)) => match a_text.cmp(b_text) {
                Ordering::Equal => {}
                other => return other,
            },
            (Token::Number(..), Token::Text(..)) => return Ordering::Less,
            (Token::Text(..), Token::Number(..)) => return Ordering::Greater,
        }
    }

    a_tokens.len().cmp(&b_tokens.len()).then_with(|| a.cmp(b))
}

#[derive(Debug, PartialEq)]
pub enum Token<'a> {
    Text(&'a str),
    Number(&'a str, u128),
}

pub fn tokenize(input: &str) -> Vec<Token<'_>> {
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut chars = input.char_indices().peekable();

    while let Some((idx, ch)) = chars.next() {
        if ch.is_ascii_digit() {
            if start < idx {
                tokens.push(Token::Text(&input[start..idx]));
            }
            let mut end = idx + ch.len_utf8();
            while let Some(&(nidx, nch)) = chars.peek() {
                if nch.is_ascii_digit() {
                    chars.next();
                    end = nidx + nch.len_utf8();
                } else {
                    break;
                }
            }
            let digits = &input[idx..end];
            let value = digits.parse::<u128>().unwrap_or(0);
            tokens.push(Token::Number(digits, value));
            start = end;
        }
    }

    if start < input.len() {
        tokens.push(Token::Text(&input[start..]));
    }

    tokens
}

pub fn sanitize_zip_path(path: &Path) -> Option<PathBuf> {
    let mut clean = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return None,
        }
    }

    if clean.as_os_str().is_empty() { None } else { Some(clean) }
}
