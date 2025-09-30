use std::path::Path;

use reader_core::fs::{Token, natural_cmp, natural_cmp_path, tokenize};

#[test]
fn natural_cmp_orders_numeric_sections() {
    let names = vec!["page10.png", "page2.png", "page1.png", "page11.png"]; // unsorted
    let mut sorted = names.clone();
    sorted.sort_by(|a, b| natural_cmp(a, b));
    assert_eq!(sorted, vec!["page1.png", "page2.png", "page10.png", "page11.png"]);
}

#[test]
fn natural_cmp_path_ignores_case_and_ext() {
    let a = Path::new("Chapter 1/001.PNG");
    let b = Path::new("chapter 1/2.png");
    let order = natural_cmp_path(a, b);
    assert!(order.is_lt());
}

#[test]
fn tokenize_splits_numbers_and_text() {
    let tokens = tokenize("Vol12-Chap003");
    assert_eq!(tokens.len(), 4);
    assert!(matches!(tokens[0], Token::Text(text) if text.eq_ignore_ascii_case("vol")));
    assert!(matches!(tokens[1], Token::Number("12", 12)));
    assert!(matches!(tokens[2], Token::Text(text) if text.eq_ignore_ascii_case("-chap")));
    assert!(matches!(tokens[3], Token::Number("003", 3)));
}
