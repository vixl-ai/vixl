use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use app_lib::commands::http::{is_blocked_ip, is_blocked_proxy_host};
use app_lib::commands::web_fetch::{accept_header_for_format, WebFetchFormat};

#[test]
fn blocks_metadata_and_link_local() {
    assert!(is_blocked_proxy_host("169.254.169.254"));
    assert!(is_blocked_proxy_host("metadata.google.internal"));
    assert!(is_blocked_proxy_host("metadata.goog"));
    assert!(is_blocked_proxy_host("instance-data"));
    assert!(is_blocked_proxy_host("fe80::1"));
    assert!(is_blocked_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1))));
    assert!(is_blocked_ip(IpAddr::V6(Ipv6Addr::new(
        0xfe80, 0, 0, 0, 0, 0, 0, 1
    ))));
}

#[test]
fn allows_loopback_rfc1918_and_public() {
    assert!(!is_blocked_proxy_host("127.0.0.1"));
    assert!(!is_blocked_proxy_host("localhost"));
    assert!(!is_blocked_proxy_host("api.openai.com"));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 31, 255, 255))));
    // CGNAT stays allowed (same as proxy).
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))));
}

#[test]
fn public_172_outside_rfc1918_not_blocked_by_ip_policy() {
    // 172.15/16 and 172.32/16 are public IPv4, not RFC 1918.
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 15, 0, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 32, 0, 1))));
}

#[test]
fn allows_ipv6_ula() {
    assert!(!is_blocked_ip(IpAddr::V6(Ipv6Addr::new(
        0xfd00, 0, 0, 0, 0, 0, 0, 1
    ))));
}

#[test]
fn accept_header_matches_format() {
    assert_eq!(
        accept_header_for_format(WebFetchFormat::Markdown),
        "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    );
    assert_eq!(
        accept_header_for_format(WebFetchFormat::Text),
        "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    );
    assert_eq!(
    accept_header_for_format(WebFetchFormat::Html),
    "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  );
}
