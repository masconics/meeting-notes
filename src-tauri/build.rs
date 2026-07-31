fn main() {
    tauri_build::build();

    // The `eventkit` crate links a static Swift bridge. That pulls in
    // `@rpath/libswift_Concurrency.dylib`. On modern macOS the concurrency
    // runtime lives in the system Swift path (dyld shared cache under
    // `/usr/lib/swift`). Dependency build-script `rustc-link-arg` rpaths often
    // don't make it onto the final binary, so set them on this package.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        // Bundled .app: look next to the executable as a fallback for any
        // future Frameworks packaging of Swift libs.
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
}
