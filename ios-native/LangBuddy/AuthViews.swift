import SwiftUI

// MARK: - 欢迎

struct WelcomeView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Text("L")
                .font(.system(size: 38, weight: .heavy))
                .foregroundColor(.white)
                .frame(width: 76, height: 76)
                .background(Theme.brandGradient)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .shadow(color: Theme.primary.opacity(0.32), radius: 17, y: 14)
                .padding(.bottom, 26)

            Text("LangBuddy").font(.system(size: 34, weight: .heavy))
            Text("语伴").font(.system(size: 34, weight: .heavy)).foregroundColor(Theme.primary)

            Text("先花 2 分钟测出你的英语水平\n之后每一句练习都按你的程度来")
                .font(.system(size: 15))
                .foregroundColor(Theme.muted)
                .multilineTextAlignment(.center)
                .lineSpacing(5)
                .padding(.top, 14)
            Spacer()

            VStack(spacing: 8) {
                Button("开始") { app.route = .register }
                    .buttonStyle(PrimaryButtonStyle())
                Button("已有账号，登录") { app.route = .login }
                    .font(.system(size: 15))
                    .foregroundColor(Theme.muted)
                    .padding(.vertical, 8)
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 16)
        }
    }
}

// MARK: - 登录

struct LoginView: View {
    @EnvironmentObject var app: AppState
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "登录") { app.route = .welcome }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    LabeledField(title: "用户名") {
                        TextField("", text: $username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .fieldStyle()
                    }
                    LabeledField(title: "密码") {
                        SecureField("", text: $password).fieldStyle()
                    }
                    if let error {
                        Text(error).font(.system(size: 13.5)).foregroundColor(Theme.danger)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 20)
            }

            VStack(spacing: 8) {
                Button(busy ? "登录中…" : "登录") { Task { await doLogin() } }
                    .buttonStyle(PrimaryButtonStyle(enabled: !busy))
                    .disabled(busy)
                Button("没有账号？去注册") { app.route = .register }
                    .font(.system(size: 15)).foregroundColor(Theme.muted).padding(.vertical, 8)
            }
            .padding(.horizontal, 22).padding(.bottom, 16)
        }
    }

    private func doLogin() async {
        error = nil
        guard !username.isEmpty, !password.isEmpty else {
            error = "请填写用户名和密码"; return
        }
        busy = true
        defer { busy = false }
        do {
            app.user = try await API.shared.login(username: username, password: password)
            await app.routeAfterAuth()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - 注册

struct RegisterView: View {
    @EnvironmentObject var app: AppState
    @State private var nickname = ""
    @State private var username = ""
    @State private var password = ""
    @State private var phone = ""
    @State private var code = ""
    @State private var hint: String?
    @State private var error: String?
    @State private var busy = false
    @State private var countdown = 0

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "创建账号") { app.route = .welcome }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    LabeledField(title: "昵称") {
                        TextField("怎么称呼你", text: $nickname).fieldStyle()
                    }
                    LabeledField(title: "用户名") {
                        TextField("3-30 位，用于登录", text: $username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .fieldStyle()
                    }
                    LabeledField(title: "密码") {
                        SecureField("至少 6 位", text: $password).fieldStyle()
                    }
                    LabeledField(title: "手机号") {
                        TextField("11 位手机号", text: $phone)
                            .keyboardType(.numberPad)
                            .fieldStyle()
                    }
                    LabeledField(title: "验证码") {
                        HStack(spacing: 8) {
                            TextField("6 位验证码", text: $code)
                                .keyboardType(.numberPad)
                                .fieldStyle()
                            Button(countdown > 0 ? "\(countdown)s" : "获取验证码") {
                                Task { await sendCode() }
                            }
                            .buttonStyle(OutlineButtonStyle())
                            .disabled(countdown > 0)
                        }
                    }
                    if let hint {
                        Text(hint).font(.system(size: 13)).foregroundColor(Theme.muted)
                    }
                    if let error {
                        Text(error).font(.system(size: 13.5)).foregroundColor(Theme.danger)
                    }
                }
                .padding(.horizontal, 22).padding(.top, 20)
            }

            Button(busy ? "提交中…" : "注册并开始测评") { Task { await doRegister() } }
                .buttonStyle(PrimaryButtonStyle(enabled: !busy))
                .disabled(busy)
                .padding(.horizontal, 22).padding(.bottom, 16)
        }
    }

    private func sendCode() async {
        error = nil
        guard phone.count == 11, phone.hasPrefix("1") else {
            error = "请输入正确的 11 位手机号"; return
        }
        do {
            let dev = try await API.shared.sendCode(phone: phone)
            hint = dev.map { "测试模式，验证码：\($0)" } ?? "验证码已发送"
            countdown = 60
            // 60 秒倒计时，避免用户狂点导致后端限流
            Task {
                while countdown > 0 {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    countdown -= 1
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func doRegister() async {
        error = nil
        busy = true
        defer { busy = false }
        do {
            app.user = try await API.shared.register(nickname: nickname, username: username,
                                                     password: password, phone: phone, code: code)
            await app.routeAfterAuth()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - 复用的顶部导航

struct NavHeader: View {
    let title: String
    var trailing: AnyView? = nil
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(Theme.text)
                    .frame(width: 44, height: 44)
            }
            Spacer()
            Text(title).font(.system(size: 16, weight: .semibold))
            Spacer()
            if let trailing { trailing } else { Color.clear.frame(width: 44, height: 44) }
        }
        .padding(.horizontal, 6)
    }
}
