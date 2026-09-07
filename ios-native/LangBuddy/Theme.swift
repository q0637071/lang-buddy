import SwiftUI

/// 统一的配色和常用控件样式，和网站的主色保持一致。
enum Theme {
    static let primary = Color(red: 10 / 255, green: 186 / 255, blue: 181 / 255)   // #0ABAB5
    static let primaryDark = Color(red: 7 / 255, green: 143 / 255, blue: 139 / 255)
    static let primaryLight = Color(red: 227 / 255, green: 251 / 255, blue: 250 / 255)
    static let accent = Color(red: 61 / 255, green: 217 / 255, blue: 210 / 255)
    static let text = Color(red: 20 / 255, green: 22 / 255, blue: 31 / 255)
    static let muted = Color(red: 122 / 255, green: 128 / 255, blue: 144 / 255)
    static let border = Color(red: 232 / 255, green: 233 / 255, blue: 240 / 255)
    static let danger = Color(red: 220 / 255, green: 38 / 255, blue: 38 / 255)

    static let brandGradient = LinearGradient(
        colors: [primary, accent],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}

/// 主按钮：底部大按钮统一用它，保证各屏手感一致
struct PrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(enabled ? Theme.primary : Theme.primary.opacity(0.45))
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct OutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .padding(.horizontal, 14).padding(.vertical, 11)
            .foregroundColor(Theme.primary)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Theme.primary, lineWidth: 1.5)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

/// 输入框：iOS 上字号小于 16 聚焦时系统会放大页面，统一用 16
struct FieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 16))
            .padding(.horizontal, 15).padding(.vertical, 14)
            .background(Color(red: 250 / 255, green: 251 / 255, blue: 252 / 255))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1.5)
            )
    }
}

extension View {
    func fieldStyle() -> some View { modifier(FieldStyle()) }
}

/// 带标题的输入行
struct LabeledField<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Theme.muted)
            content
        }
        .padding(.bottom, 16)
    }
}
