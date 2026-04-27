{
  "targets": [
    {
      "target_name": "livecaptions_native",
      "sources": [
        "livecaptions.cpp",
        "win32_automation.cpp"
      ],
      "include_dirs": [
        "<(module_root_dir)/../node_modules/node-addon-api"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.7"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/EHsc", "/std:c++20"]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "-lUIAutomationCore.lib",
            "-lOle32.lib",
            "-lOleAut32.lib"
          ]
        }]
      ]
    }
  ]
}

