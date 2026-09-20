import AppKit
import WebKit

let port = ProcessInfo.processInfo.environment["BITA_MEASURE_PORT"] ?? "8731"
let target = URL(string: "http://127.0.0.1:\(port)/index.html")!

let web = WKWebView(
    frame: NSRect(x: 0, y: 0, width: 380, height: 520),
    configuration: WKWebViewConfiguration()
)

let probe = """
(() => {
  const box = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return { selector, missing: true };
    const rect = node.getBoundingClientRect();
    return { selector, top: +rect.top.toFixed(1), height: +rect.height.toFixed(1) };
  };
  return JSON.stringify({
    sheets: document.styleSheets.length,
    viewport: window.innerHeight,
    boxes: ['#panel', '.bar', '.bar-wordmark', '.tabs', '.view', '#launcher'].map(box),
  });
})()
"""

let panelBorder = 1.0

let expected: [String: (Double, Double)] = [
    "#panel": (0, 520),
    ".bar": (panelBorder, 44),
]

final class Probe: NSObject, WKNavigationDelegate {
    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            view.evaluateJavaScript(probe) { value, error in
                if let error { print("error al medir: \(error)"); exit(1) }
                guard let text = value as? String,
                      let data = text.data(using: .utf8),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let boxes = json["boxes"] as? [[String: Any]]
                else { print("respuesta ilegible"); exit(1) }

                if (json["sheets"] as? Int ?? 0) == 0 {
                    print("no se cargó ninguna hoja de estilos"); exit(1)
                }

                var failed = false
                for box in boxes {
                    let selector = box["selector"] as! String
                    if box["missing"] != nil {
                        print("✗ \(selector): no está en el panel"); failed = true; continue
                    }
                    let top = box["top"] as! Double
                    let height = box["height"] as! Double
                    var note = ""
                    if top < 0 {
                        note = "  ✗ empieza \(-top) px por encima del panel"; failed = true
                    }
                    if let (wantTop, wantHeight) = expected[selector] {
                        if abs(top - wantTop) > 0.5 || abs(height - wantHeight) > 0.5 {
                            note += "  ✗ se esperaba top=\(wantTop) h=\(wantHeight)"
                            failed = true
                        }
                    }
                    print(String(format: "%-16@ top=%7.1f  h=%7.1f%@",
                                 selector as NSString, top, height, note as NSString))
                }
                exit(failed ? 1 : 0)
            }
        }
    }

    func webView(_ view: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("fallo de carga: \(error)")
        exit(1)
    }

    func webView(_ view: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("fallo de carga: \(error)")
        exit(1)
    }
}

let delegate = Probe()
web.navigationDelegate = delegate
web.load(URLRequest(url: target))

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
app.run()
