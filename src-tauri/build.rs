fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut res = winres::WindowsResource::new();
        res.set_manifest_file("md-editor.exe.manifest");
        res.compile().unwrap();
    }
    tauri_build::build()
}
