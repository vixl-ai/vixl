fn main() {
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
