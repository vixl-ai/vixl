use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use app_lib::commands::http::{is_blocked_ip, is_blocked_proxy_host};

#[test]
fn blocks_metadata_and_link_local() {
    assert!(is_blocked_proxy_host("169.254.169.254"));
    assert!(is_blocked_proxy_host("metadata.google.internal"));
    assert!(is_blocked_proxy_host("fe80::1"));
    assert!(is_blocked_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1))));
    assert!(is_blocked_ip(IpAddr::V6(Ipv6Addr::new(
        0xfe80, 0, 0, 0, 0, 0, 0, 1
    ))));
}

#[test]
fn allows_loopback_and_public() {
    assert!(!is_blocked_proxy_host("127.0.0.1"));
    assert!(!is_blocked_proxy_host("localhost"));
    assert!(!is_blocked_proxy_host("api.openai.com"));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 31, 255, 255))));
}

#[test]
fn public_172_outside_rfc1918_not_blocked() {
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 15, 0, 1))));
    assert!(!is_blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 32, 0, 1))));
}

#[test]
fn allows_ipv6_ula() {
    assert!(!is_blocked_ip(IpAddr::V6(Ipv6Addr::new(
        0xfd00, 0, 0, 0, 0, 0, 0, 1
    ))));
}
