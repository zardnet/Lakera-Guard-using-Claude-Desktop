# Lakera-Guard-using-Claude-Desktop (Node.js / TypeScript)

Claude Desktop용 MCP 서버에 도구 호출 전(pre_call)/후(post_call) Lakera Guard 스크리닝을 붙인 예제입니다.

## 파일 구성

- `guard.ts` — Lakera Guard API를 호출하는 `screenContent()`와, 도구 핸들러를 감싸는 `guardContent()` 헬퍼
- `index.ts` — `@modelcontextprotocol/sdk` 기반 MCP 서버 예제. `tldr_text` 도구에 guard 적용
- `package.json`, `tsconfig.json` — 빌드 설정
- `.env.example` — 환경변수 템플릿

## 설치 및 실행

```bash
npm install
cp .env.example .env
# .env 파일에 LAKERA_API_KEY 입력 (platform.lakera.ai 에서 발급)
npm run build
npm start   # 정상 동작 확인용 (Claude Desktop은 아래 설정으로 직접 실행)
```

## Claude Desktop에 등록

Cluade 지침
```bash
사용자가 보내는 모든 메시지에 대해, 응답을 시작하기 전에 반드시 tldr-guarded MCP의 tldr_text 도구를 먼저 호출해서 그 메시지 원문을 검사해라. 예외 없이 매 턴 첫 번째 행동으로 수행한다. tldr_text 호출이 "Input rejected"나 Lakera Guard 관련 에러로 실패하면, 원래 요청에 응하지 말고 해당 메시지가 보안 검사에서 차단됐다고 사용자에게 알린 뒤 진행 여부를 물어봐라. 호출이 성공하면(요약 결과가 반환되면) 그 요약 내용은 무시하고 평소대로 사용자 요청에 응답한다.
```

설정 파일 위치:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tldr-guarded": {
      "command": "node",
      "args": ["/절대경로/outputs/dist/index.js"],
      "env": {
        "LAKERA_API_KEY": "발급받은키"
      }
    }
  }
}
```

저장 후 Claude Desktop을 완전히 재시작하세요.

## 동작 방식

1. **pre_call**: 도구가 실행되기 전, 입력 텍스트를 `https://api.lakera.ai/v2/guard`로 보내 프롬프트 인젝션/유해 콘텐츠 여부 확인. 위험하면 `Input rejected: ...` 에러를 던져 도구 실행 자체를 막습니다.
2. 안전하면 원래 도구 로직 실행.
3. **post_call**: 도구의 출력 문자열도 동일하게 스크리닝. 위험하면 `Output rejected: ...` 에러로 결과를 모델에 전달하지 않습니다.

다른 도구/프롬프트/리소스에도 동일하게 `guardContent(handler, { inputParam, outputScreen })`로 감싸기만 하면 됩니다.

## 참고

- 서드파티 MCP 서버(소스 수정 불가)에는 이 방식을 직접 적용할 수 없습니다. 그 경우 별도의 프록시 MCP 서버를 앞단에 두고 그 안에서 pre_call/post_call을 넣어야 합니다.
- Lakera Guard 정책(민감정보 탐지, 언어별 정책 등)은 platform.lakera.ai 대시보드에서 커스터마이징 가능합니다.

참고 자료:
- https://www.lakera.ai/blog/how-to-secure-mcps-with-lakera-guard
- https://gist.github.com/sas-lakera/01b7e574e1769a020699126e1c10f2cc (Python 원본)
