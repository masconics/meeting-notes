fn main() {
    tauri_build::build();

    let swift_lib = "/usr/lib/swift";
    println!("cargo:rustc-link-arg=-Wl,-rpath,{swift_lib}");

    let sdk_path = std::process::Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-path"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string());
    if let Some(sdk) = sdk_path {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{sdk}/usr/lib/swift");
    }
}
