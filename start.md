# Start

## Goal
이 시스템의 목표는 사용자가 brief를 주면 AI가 초기 프로그래밍 그래프를 만들고, 사용자가 그 그래프를 수정하고 승인한 뒤, 승인된 그래프를 기준으로 앱을 **한 단계씩 누적 개발**하게 만드는 것이다.

최종 목표는 아래와 같다.

1. 처음에는 AI가 전체 그래프 초안을 만든다.
2. 사용자는 그래프를 수정하고 평가한다.
3. 승인된 그래프를 기준으로 한 단계씩 build 한다.
4. 각 단계는 반드시 테스트를 남긴다.
5. 사람 승인 없이는 다음 단계로 넘어가지 않는다.
6. 마지막 단계까지 완료되면 완성 앱이 된다.

---

## Current Implementation Scope

이 문서는 최종 설계와 현재 구현 범위를 같이 기록한다.

현재 기준으로는 **전체 제품을 한 번에 구현하지 않고, 아래 순서대로 step-by-step으로 진행한다.**

### Current Status
- `Step 0. Workspace Bootstrap`: 진행 중, 핵심 골격 구현됨
- `Step 1. Brief To Initial Graph`: 부분 구현됨
  - live diagram generation 실전 테스트 완료
- `Step 2. Human Graph Editing`: 구현됨
- `Step 3. Graph Review`: 부분 구현됨
- `Step 4. Step Availability`: 부분 구현됨
- `Step 5. Step Preparation`: 부분 구현됨
- `Step 6. Step Build`: 부분 구현됨
- `Step 7. Step Test`: 부분 구현됨
- `Step 8. Human Approval`: 부분 구현됨
- `Step 9. Final Completion`: 미구현

### What Is Actually Done Now
현재 실제 코드 기준으로 끝난 것은 **Workspace Bootstrap -> diagram generation -> human editing -> graph approval -> reachable step gating**까지의 골격이다.

구체적으로는 아래까지 반영되어 있다.

- `Open Folder`로 native workspace를 연다.
- 무거운 폴더와 파일은 tree 인덱싱에서 제외한다.
- workspace bootstrap 상태를 계산한다.
- 마지막 native workspace를 다시 여는 흐름이 있다.
- harness가 없으면 diagram generation을 막는다.
- Codex/GPT-5.4 runtime이 ready가 아니면 diagram generation을 막는다.
- 사용자가 brief를 입력하고 live diagram generation을 실행할 수 있다.
- draft diagram을 수정하고 자동 저장할 수 있다.
- `Approve Graph`로 승인된 graph source of truth를 고정할 수 있다.
- 승인된 graph 기준으로 reachable / blocked / approved step 상태를 계산한다.
- selection spec/build는 승인된 graph의 reachable node 하나에만 허용된다.
- `Approve Current Step`으로 step history를 기록하고 다음 reachable node를 연다.
- selection build는 current step contract와 out-of-scope verifier를 통과해야만 성공한다.
- build 실패와 verifier 위반은 `.graphcoding/mistake.md`에 누적 기록되고 bounded repair loop로 다시 시도된다.

즉, 지금 구현 상태를 한 줄로 말하면 아래와 같다.

**현재는 `폴더 열기 + workspace bootstrap + diagram generation + human editing + graph approval + reachable step gating`까지가 중심이며, 최종 reconciliation과 완전한 누적 테스트 계약은 아직 남아 있다.**

### Delivery Order
이후 구현은 반드시 아래 순서대로 진행한다.

1. `Workspace Bootstrap`을 완전히 고정한다.
2. `Brief To Initial Graph`를 더 정확하게 만든다.
3. `Graph Review`를 더 깊게 만들어 graph 자체 문제를 진단한다.
4. `Reachable / Blocked Step 계산`을 더 엄격하게 고친다.
5. `Step Preparation`의 contract를 더 구조화한다.
6. `Step Build`를 현재 단계 전용으로 더 엄격하게 고친다.
7. `Step Test`를 누적 테스트 기준으로 고정한다.
8. `Human Approval`과 retry/reject 흐름을 완성한다.
9. 마지막에 `Final Completion`을 붙인다.

---

## 0. Workspace Bootstrap

모든 작업은 `Open Folder`부터 시작한다.

### 0.0 Status
현재 단계의 기준 상태는 아래와 같다.

- `Open Folder`: 구현됨
- `Harness gating`: 구현됨
- `Runtime readiness gating`: 구현됨
- `Workspace bootstrap summary UI`: 구현됨
- `Open Folder / reload / read-file / write-artifacts server tests`: 구현됨
- `Managed / unmanaged live browser bootstrap tests`: 구현됨
- `Workspace reopen branching classifier`: 구현됨
- `Workspace validity / project suitability 검사`: 아직 단순함
- `Bootstrap 이후 graph review 자동 연결`: 미구현

### 0.1 Open Folder
사용자는 먼저 `Open Folder`로 실제 작업 폴더를 연다.

이 단계가 필요한 이유는 다음과 같다.

- 이후 코드 생성은 실제 로컬 폴더에 직접 써야 한다.
- build 결과와 테스트 결과가 실제 workspace 기준으로 누적되어야 한다.
- step-by-step 개발은 같은 폴더에서 이어져야 한다.

### 0.1.1 What Open Folder Must Guarantee
`Open Folder`는 단순히 파일 탐색기만 여는 기능이면 안 된다.

이 단계에서 시스템은 아래를 보장해야 한다.

- 사용자가 선택한 경로를 현재 workspace root로 고정한다.
- 사용자가 폴더를 하나 선택하면, 그 폴더 자체가 현재 작업 기준 root로 선택되어야 한다.
- 이후 `read-file`, `write-artifacts`, `build`, `test`는 모두 이 root 기준으로만 동작한다.
- workspace root가 바뀌면 이전 workspace에서 준비된 spec, build 상태, step 준비 상태는 무효화된다.
- 같은 폴더를 다시 열면 이전 native workspace로 복원 가능해야 한다.
- Open Folder 자체는 build를 시작하지 않고, bootstrap 상태만 초기화해야 한다.

### 0.1.2 Validation And Safety Rules
`Open Folder` 단계에서는 아래 검사가 필요하다.

- 선택한 경로는 실제 directory여야 한다.
- path traversal은 허용하면 안 된다.
- symlink 경로는 따라가지 않거나 명확한 정책으로 제한해야 한다.
- `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage` 같은 무거운 폴더는 인덱싱에서 제외해야 한다.
- `.DS_Store` 같은 시스템 파일은 workspace 판단에 섞이면 안 된다.

### 0.1.3 What The User Must See After Open Folder
폴더를 열고 나면 사용자는 최소한 아래 정보를 바로 볼 수 있어야 한다.

- 현재 workspace root 경로
- workspace 이름
- workspace kind 추정 결과
- 인덱싱된 파일 수
- 제외된 heavy directory 수
- symlink skip 여부
- harness 존재 여부

즉, `Open Folder`가 성공했는지 여부는 단순히 트리가 보이는 것만으로 판단하면 안 되고, workspace bootstrap 상태가 함께 보여야 한다.

### 0.1.4 Failure Handling
아래 경우에는 `Open Folder`가 조용히 실패하면 안 된다.

- 사용자가 폴더 선택을 취소한 경우
- 잘못된 경로를 연 경우
- directory가 아닌 파일을 선택한 경우
- 현재 환경에서 native folder dialog를 열 수 없는 경우

이때 시스템은 아래를 보장해야 한다.

- workspace 상태를 애매하게 반쯤 바꾸지 않는다.
- 이전 정상 workspace가 있으면 그대로 유지한다.
- 왜 실패했는지 사용자에게 명확히 알려준다.

### 0.1.5 Resume / Reopen Branching
사용자가 작업하다가 앱을 껐다가 다시 켜고 같은 폴더를 열 수 있다.

이때 시스템은 단순히 파일 트리만 다시 보여주면 안 되고, 현재 workspace가 어떤 상태인지 먼저 분류해야 한다.

이 단계의 바깥 분기는 2개로만 보면 된다.

- `이 시스템이 이미 관리한 workspace`
- `이 시스템이 아직 관리하지 않은 workspace`

이 1차 판정은 우리 시스템 전용 manifest로만 한다.

- `.graphcoding/manifest.json`

즉 규칙은 간단하다.

- `manifest.json`이 있고 유효하면: `이 시스템이 이미 관리한 workspace`
- `manifest.json`이 없으면: `이 시스템이 아직 관리하지 않은 workspace`

여기서 말하는 `유효한 manifest`는 최소한 아래를 포함해야 한다.

- 우리 시스템 전용 marker
- app 식별자
- format version
- workspace id

일반 코드 파일인 `package.json`, `src`, `tests` 같은 것은
`우리 시스템이 만든 폴더인지`를 판정하는 1차 기준으로 쓰면 안 된다.
그것들은 오직 2차 해석용 신호로만 사용해야 한다.

#### A. 이 시스템이 이미 관리한 workspace
이 경우에는 먼저 이전에 했던 것을 최대한 복원할 수 있는지 본다.

즉 아래 정보를 다시 읽어와야 한다.

- manifest
- 저장된 harness
- 저장된 graph
- 저장된 workflow-state
- 저장된 step history
- 이전 분기 결정

이 경로에서는 사용자가 전에 했던 작업을 최대한 그대로 복구하는 것이 우선이다.

이 안에서도 내부적으로는 아래처럼 나뉠 수 있다.

- harness만 있는 상태
- graph draft까지만 있는 상태
- workflow가 진행 중인 상태
- graph와 workflow가 어긋난 상태
- graph는 있는데 대응 코드가 부족한 상태

하지만 이건 내부 판정용 세부 분기이고, 사용자에게는 먼저
`이 시스템이 이미 관리한 workspace인지`
부터 명확히 보여주는 게 맞다.

#### B. 이 시스템이 아직 관리하지 않은 workspace
이 경우에는 이전 graph workflow가 없으므로, 시스템이 현재 폴더를 읽고 기본 셋업을 고정해야 한다.

즉 아래를 먼저 판단한다.

- 어떤 프레임워크인지
- 어떤 패키지 매니저인지
- 어떤 런타임인지
- 코드가 이미 많은지
- 테스트 도구가 있는지
- 기존 앱 구조를 어느 정도 추론할 수 있는지

그 다음 아래 중 하나로 간다.

- 코드가 거의 없으면 새 graph workflow를 시작한다
- 코드가 이미 있으면 기존 코드를 기준으로 graph intake를 시작한다

현재 구현 기준으로는 이 두 경우를 사용자에게 다시 묻지 않는다.

- `unmanaged + 코드 있음`은 자동으로 `기존 코드 기반 intake`로 고정한다
- 이 경우 system이 code-aware brief 초안을 미리 채워주지만, 사용자가 최종 brief를 직접 수정하거나 새로 적을 수 있어야 한다
- `unmanaged + 코드 없음`은 자동으로 `fresh workflow`로 고정한다

이 경로에서는 아직 graph workflow가 없기 때문에, 시스템이 먼저 아래를 고정한다.

- `.graphcoding/manifest.json`
- `.graphcoding/resume-state.json`

그 다음 `Workspace Setup`을 열어서 사용자가 harness를 저장한다.

즉 이 구간의 기본 셋업 고정은 아래를 의미한다.

- `manifest`
- `harness`
- `resume state`

이후에는 아직 graph가 없으므로, 빈 diagram 상태를 보여준다.
사용자는 여기서 brief를 적고 diagram 버튼을 눌러야만 첫 graph가 생성된다.

질문이 필요한 경우는 예외로만 남긴다.

- legacy `.graphcoding` 흔적은 있는데 `manifest`가 없는 경우
- 저장된 graph와 workflow가 어긋난 경우
- 현재 source of truth를 버리는 파괴적 재시작이 필요한 경우

이 단계에서 시스템은 아래를 보장해야 한다.

- 먼저 `manifest-first`로 `우리 시스템이 이미 관리한 폴더인지 아닌지`를 판정한다
- 이미 관리한 폴더면 이전 상태 복원을 우선한다
- 관리하지 않은 폴더면 현재 코드/설정을 읽어 `code intake` 또는 `fresh workflow`로 자동 분류한다
- `unmanaged + 코드 있음`은 자동으로 `analyze-existing-code`로 고정한다
- `unmanaged + 코드 없음`은 자동으로 `initialize-fresh-workflow`로 고정한다
- 이 자동 분기 후에 `manifest`와 `resume state`를 먼저 기록한다
- 그 다음 `Workspace Setup`에서 harness를 저장하게 한다
- 애매한 경우에만 질문한다
- 이전 상태가 있어도 graph와 workflow가 어긋나면 자동 build를 시작하면 안 된다
- 사용자의 분기 선택은 workspace 안의 `.graphcoding/resume-state.json`에 저장되어야 한다
- 한 번 고정한 분기 결정은 같은 폴더를 다시 열었을 때 그대로 복원되어야 한다
- 분기 결과와 추천 다음 액션을 사용자에게 명확히 보여줘야 한다

### 0.2 Harness Setup
폴더를 연 뒤에는 `Edit Harness` 또는 `Create Harness`로 하네스를 먼저 고정한다.

하네스는 아래를 고정하는 역할을 한다.

- 앱 타입
- 프론트엔드/백엔드 스택
- 패키지 매니저
- 런타임
- 스타일링 방향
- 데이터 저장 방식
- 인증 방식
- 테스트 정책
- sandbox 정책
- 도구 사용 정책

하네스가 없는 상태에서는 아래 작업을 시작하지 않는다.

- 초기 diagram 생성
- spec 생성
- step build
- final build

현재 구현 기준으로 unmanaged workspace는 `manifest / resume state`를 먼저 고정한 뒤, harness 저장 단계로 넘어간다.
즉 `기본 셋업 고정`은 최종적으로 아래 3가지를 뜻한다.

- `manifest`
- `harness`
- `resume state`

### 0.3 Diagram Generation Trigger
기본 셋업 완료는 diagram generation 시작과 동일하지 않다.

즉 아래를 명확히 구분해야 한다.

- `manifest / harness / resume state` 같은 기본 셋업이 끝난 상태
- 사용자가 실제로 diagram generation을 시작한 상태

diagram generation은 항상 사용자의 명시적 액션으로만 시작되어야 한다.

처음에는 아래 버튼 중 하나를 사용자가 직접 눌러야 한다.

- `Generate First Diagram`

이미 diagram이 존재하는 상태에서는 아래 버튼을 사용자가 직접 눌러야 한다.

- `Refine Current Diagram`
- `Replace Diagram`

이 단계에서 시스템은 아래를 보장해야 한다.

- 기본 셋업이 끝났다고 해서 diagram generation을 자동으로 시작하면 안 된다.
- 사용자가 버튼을 누르기 전에는 현재 diagram을 바꾸면 안 된다.
- 이미 diagram이 있으면 그것이 현재 graph workflow의 source of truth다.
- 사용자가 `Replace Diagram`을 누르지 않는 한 기존 diagram을 임의로 새로 만들면 안 된다.
- `Build`는 diagram generation 단계가 아니라, 현재 승인된 graph를 기준으로 spec/build를 수행하는 단계여야 한다.
- build를 눌렀다고 해서 시스템이 diagram을 다시 생성하거나 덮어쓰면 안 된다.

현재 draft diagram은 workspace 안의 아래 파일로 저장되어야 한다.

- `.graphcoding/diagram.graph.json`

승인된 graph source of truth는 별도 파일로 관리되어야 한다.

- `.graphcoding/diagram.approved.json`

즉 사용자가 같은 폴더를 다시 열었을 때, 시스템은 저장된 diagram을 다시 읽어서 복원할 수 있어야 한다.

현재 구현 기준으로는 아래처럼 동작한다.

- `managed`이고 저장된 `diagram.graph.json`이 있으면 자동 복원해서 바로 보여준다
- `unmanaged`에서 기본 셋업만 끝난 상태라면 아직 graph가 없으므로 빈 diagram 상태를 보여준다
- `unmanaged + 코드 있음`이면 code-aware brief 초안을 먼저 채워준다
- 하지만 최종 graph generation은 사용자가 brief를 직접 확인하거나 수정한 뒤 버튼을 눌렀을 때만 시작된다
- 이 빈 상태에서 사용자가 `Generate First Diagram`을 눌러야만 AI가 첫 graph를 생성한다
- draft를 수정한 뒤에는 `Approve Graph`를 다시 눌러야 승인된 graph source of truth가 갱신된다

### 0.4 Runtime Readiness
초기 diagram 생성 전에는 Codex/GPT-5.4 런타임이 `ready` 상태여야 한다.

준비 조건은 다음과 같다.

- Codex 설치됨
- ChatGPT 로그인 완료
- GPT-5.4 호출 가능

준비되지 않았다면 diagram generation을 시작하지 않는다.

---

## 1. Brief To Initial Graph

### 1.0 Status
현재 단계의 기준 상태는 아래와 같다.

- `Brief 입력`: 구현됨
- `unmanaged + 코드 있음`의 code-aware brief 초안 채우기: 구현됨
- `Generate First Diagram / Refine / Replace`: 구현됨
- `Harness + runtime 조건 검사`: 구현됨
- `live UI end-to-end diagram generation`: 구현됨
- `도메인 정확도 보정`: 아직 부족함
- `Graph approval과의 연결`: 구현됨
- `생성 결과를 이후 step workflow의 draft graph로 연결`: 구현됨

### 1.1 User Input
사용자는 우측 AI 패널의 `Brief to Diagram`에 만들고 싶은 앱이나 기능을 적는다.

brief는 짧아도 되지만, 가능하면 아래 정보가 들어 있으면 좋다.

- 어떤 앱인지
- 핵심 사용자가 누구인지
- 가장 중요한 기능이 무엇인지
- 반드시 들어가야 하는 화면, 데이터, 외부 연동, 제약이 무엇인지

### 1.2 Inputs Used By The System
시스템은 초기 그래프를 만들 때 아래 입력을 함께 본다.

- brief
- 현재 harness
- 현재 diagram
- strategy

strategy는 두 가지다.

- `replace`: 현재 diagram은 참고만 하고 새 전체 그래프를 만든다.
- `augment`: 현재 diagram을 기반으로 더 나은 전체 그래프로 확장한다.

### 1.3 Buttons
초기 diagram 생성 관련 버튼은 아래처럼 동작해야 한다.

- diagram이 비어 있으면 `Generate First Diagram`
- 이미 diagram이 있으면 `Refine Current Diagram`
- 이미 diagram이 있을 때 전체를 다시 만들고 싶으면 `Replace Diagram`

### 1.4 What AI Must Do
AI는 이 단계에서 코드를 만들면 안 된다.

이 단계의 목표는 **이후 단계별 build가 가능한 전체 그래프 초안**을 만드는 것이다.

AI는 초기 그래프를 만들 때 아래 규칙을 따라야 한다.

- brief의 핵심 도메인 명사와 제품 의도를 유지한다.
- 핵심 사용자 흐름, 주요 화면, 서비스, 저장소, 외부 연동을 그래프로 구조화한다.
- 이후 step-by-step build가 가능하도록 노드와 방향 관계를 만든다.
- 사용자가 명시하지 않은 선택 기능을 핵심 흐름에 강제로 넣지 않는다.
- 있으면 좋은 기능은 `추천` 성격의 note나 보조 노드로 분리한다.
- 불명확한 부분은 확정 기능처럼 만들지 말고 사람이 검토할 수 있게 드러낸다.
- 결과는 항상 전체 diagram이어야 하며 patch나 일부 조각만 반환하면 안 된다.

### 1.5 Minimum Diagram Output
초기 그래프는 최소한 아래를 포함해야 한다.

- `title`
- `summary`
- 핵심 노드들
- 각 노드의 `shape`
- 각 노드의 `title`
- 각 노드의 `actor`
- 각 노드의 `intent`
- 각 노드의 `behavior`
- 각 노드의 `inputs`
- 각 노드의 `outputs`
- 필요한 경우 `notes`
- 필요한 경우 `testHint`
- 노드 간 방향성 있는 관계선

### 1.6 Failure And Fallback
GPT-5.4 호출이 실패하거나 지연되면 시스템은 fallback diagram을 만들 수 있다.

이 경우 아래가 반드시 보장되어야 한다.

- 결과 카드에 `fallback`임을 명확히 표시
- fallback 사유 표시
- 사용자는 그 결과를 임시 초안으로 보고 다시 refine 또는 replace 가능

### 1.7 Completion Of Step 1
이 단계의 결과는 사람이 검토하고 수정할 수 있는 **초기 전체 그래프 초안**이다.

이 단계에서는 아직 아래 작업을 시작하지 않는다.

- spec 생성
- step build
- full build

---

## 2. Human Graph Editing

### 2.0 Status
현재 기준으로는 이 단계의 핵심 편집 기능이 구현되었다.

- 노드 추가: 구현됨
- 노드 삭제: 구현됨
- 선택한 노드 복제: 구현됨
- 선 연결 추가: 구현됨
- 선택한 선 삭제: 구현됨
- 노드 제목 / actor / intent / behavior / inputs / outputs / notes / testHint 수정: 구현됨
- 노드 shape 변경: 구현됨
- 노드 status 변경: 구현됨
- 선 relation / lineStyle / animated / notes 수정: 구현됨
- 선택 해제: 구현됨
- 키보드 편집 단축키
  - `Delete` / `Backspace`: 선택 삭제
  - `Escape`: 선택 해제
  - `Cmd/Ctrl + D`: 선택 노드 복제
- 편집 dirty state / saving state / saved state 표시: 구현됨
- 편집 결과의 `.graphcoding/diagram.graph.json` 반영: live 테스트 완료
- 노드 병합 / 분리 전용 워크플로우: 아직 없음
- approval stale 표시와 build 잠금: 구현됨

초기 그래프가 생성된 뒤, 사용자는 그래프를 직접 수정할 수 있어야 한다.

사용자는 아래를 수정할 수 있어야 한다.

- 노드 추가/삭제
- 선택한 노드 복제
- 선 연결 수정
- 선택한 선 삭제
- 노드 제목 수정
- actor 수정
- shape 수정
- status 수정
- intent 수정
- behavior 수정
- inputs/outputs 수정
- note/testHint 수정
- 선 relation / lineStyle / animation / notes 수정

사용자는 AI가 만든 그래프를 그대로 쓰지 않고, 필요하면 다음을 한다.

- 누락된 단계 추가
- 불필요한 단계 제거
- 잘못 해석된 intent/behavior 수정
- 흐름 순서 조정
- 도메인 의도에 맞게 노드 분리 또는 병합

이 단계에서 그래프 내용이 바뀌면 이후 승인 및 step 준비 상태는 다시 계산되어야 한다.

현재 구현 기준으로는 아래가 보장되어야 한다.

- 복원된 diagram을 바로 사람이 수정할 수 있어야 한다
- 편집은 inspector와 canvas 양쪽에서 이어서 진행할 수 있어야 한다
- 편집 중에는 `unsaved edits` 또는 `saving...` 상태가 보여야 한다
- 저장이 끝나면 `saved` 상태가 보여야 한다
- 수정 결과는 `.graphcoding/diagram.graph.json`에 다시 기록되어야 한다
- 수정된 draft가 승인된 graph와 달라지면 approval이 stale 상태가 되어야 한다
- stale 상태에서는 spec/build를 막고 다시 `Approve Graph`를 요구해야 한다

---

## 3. Graph Review

### 3.0 Status
이 단계는 부분 구현되었다.

현재 구현된 것:

- `Approve Graph` 버튼: 구현됨
- 승인된 graph artifact 저장: 구현됨
- graph hash 기반 stale 판정: 구현됨
- 승인된 graph 기준 workflow-state 저장: 구현됨
- executable node / reachable node 계산의 입력 준비: 구현됨

아직 부족한 것:

- graph 자체의 구조 문제를 깊게 진단하는 review report
- cycle, split/merge 품질, weak boundary에 대한 상세 피드백
- AI 보조 review 요약

그래프를 만든 뒤 바로 build 하지 않는다.

먼저 시스템이 그래프 전체를 읽고 다음을 판단해야 한다.

- 전체 제품 흐름
- 각 노드의 역할
- 선행/후행 관계
- 어떤 노드가 실제 executable node인지
- 어떤 노드가 설명용인지
- 단계별로 나눠서 개발 가능한지
- 어떤 노드는 단독으로 build 가능한지
- 어떤 노드는 지금 build하면 안 되는지

### 3.1 Executable Node
기본적으로 아래 shape는 executable node 후보로 본다.

- `startEnd`
- `screen`
- `process`
- `decision`
- `input`
- `database`
- `api`
- `service`
- `queue`
- `state`
- `event`
- `auth`
- `external`

아래는 기본적으로 설명/보조용으로 본다.

- `note`
- `document`
- `group`

### 3.2 What Review Must Produce
Graph Review 결과는 아래를 만들어야 한다.

- 전체 그래프 해석
- executable node 목록
- 각 노드의 선행 조건
- reachable node 후보
- blocked node와 그 이유
- 그래프 자체 문제점

### 3.3 Human Graph Approval
시스템 review가 끝나도 사람이 그래프를 승인해야 한다.

사람은 아래를 보고 승인한다.

- 그래프가 brief 의도와 맞는지
- 핵심 흐름이 빠지지 않았는지
- 노드 분리가 적절한지
- 이후 단계별 build가 가능해 보이는지

그래프 승인 전까지는 step build를 시작하지 않는다.

현재 구현 기준으로는 아래처럼 동작한다.

- `Approve Graph`를 누르면 현재 draft diagram에서 승인본을 만든다
- 승인본은 `.graphcoding/diagram.approved.json`에 저장된다
- 승인 시점의 graph hash가 workflow-state에 기록된다
- 이후 spec/build는 draft가 아니라 승인된 graph를 기준으로만 동작한다
- draft가 다시 바뀌면 approval stale 상태가 되어 spec/build가 잠긴다

---

## 4. Step Availability

### 4.0 Status
이 단계는 부분 구현되었다.

현재 구현된 것:

- executable shape 분류: 구현됨
- annotation shape 분류: 구현됨
- reachable / blocked / approved 계산: 구현됨
- 선택한 노드의 현재 상태 표시: 구현됨
- blocked selection에 대한 spec/build 거부: 구현됨

아직 부족한 것:

- blocked 이유의 더 세밀한 구조화
- dependency 설명의 더 친절한 UI

그래프 승인이 끝난 뒤에도 아무 노드나 build 가능한 것은 아니다.

### 4.1 Reachable Rule
현재 build 가능한 노드는 반드시 `reachable` 상태여야 한다.

reachable 조건은 아래와 같다.

- 그래프상 선행 executable node가 모두 완료됨
- 현재 노드가 단계적으로 독립 실행 가능함
- 현재 노드가 최소 boundary만으로 성립 가능함

### 4.2 Blocked Rule
아래 경우에는 노드를 `blocked`로 둔다.

- 현재 노드만으로는 의미 있는 단계 구현이 불가능할 때
- 다음 단계 기능까지 미리 만들어야만 동작할 때
- 현재 범위를 넘는 구현이 예상될 때
- 테스트 가능한 종료 조건을 만들 수 없을 때

blocked일 때 시스템은 아래를 반드시 알려야 한다.

- 왜 지금 build할 수 없는지
- 어떤 선행 노드가 먼저 끝나야 하는지
- 어떤 노드를 함께 고려해야 하는지
- 현재 노드 텍스트에서 무엇이 더 구체적이어야 하는지

### 4.3 Scope Size Rule
기본 원칙은 아래와 같다.

- 1 step = 1 executable node
- boundary는 최소 contract/stub만 허용
- out-of-scope 기능은 구현 금지
- 현재 단계 전용 테스트만 추가
- 과도한 mock UI, seeded screen, inventory panel 생성 금지

현재 구현 기준으로는 다음이 추가로 보장된다.

- `note`, `document`, `group`는 annotation 상태로 보고 step build 대상에서 제외한다
- 승인된 step history를 기준으로 다음 reachable node를 계산한다
- 이미 approved된 node는 다시 selection build 대상으로 쓰지 않는다

---

## 5. Step Preparation

### 5.0 Status
이 단계는 부분 구현되었다.

현재 구현된 것:

- full spec 생성: 구현됨
- selection spec 생성: 구현됨
- selection spec은 승인된 graph의 reachable node 1개에만 허용: 구현됨
- annotation / blocked / approved node selection 거부: 구현됨

아직 부족한 것:

- step contract의 더 구조화된 JSON 스키마
- blocked 이유를 직접 연결하는 step prep report

사람이 reachable node를 선택하면, 시스템은 그 노드를 바로 구현하지 않고 먼저 현재 단계 명세를 만든다.

현재 단계 명세에는 아래가 포함되어야 한다.

- 지금 구현할 정확한 노드
- 이 노드가 전체 시스템에서 맡는 역할
- 이 단계에서 꼭 구현해야 하는 것
- 이 단계에서 허용되는 최소 boundary
- 이 단계에서 구현하면 안 되는 것
- 완료 조건
- 테스트 조건

중요한 점은 다음과 같다.

- 시스템은 현재 단계를 준비할 때도 승인된 그래프 전체를 먼저 이해해야 한다.
- 하지만 실제 구현 범위는 전체가 아니라 현재 선택 단계만이어야 한다.

---

## 6. Step Build

### 6.0 Status
기본 `spec -> build` 경로는 있고, `reachable 기반 1-step build`의 핵심 게이트도 구현되었다.

현재 구현된 것:

- build는 승인된 graph가 없으면 시작되지 않음
- graph approval이 stale이면 build가 잠김
- selection build는 reachable node 1개 selection + matching selection spec이 있어야만 시작됨
- successful selection build 뒤에 `Approve Current Step` 가능
- build 실패 시 bounded repair loop를 다시 돌림
- 실패 이력은 `.graphcoding/mistake.md`에 기록됨
- selection build 직전에 `.graphcoding/current-step-contract.json`을 기록함
- selection build 후 server-side out-of-scope verifier가 changed files를 검사함
- verifier가 touched file 수, package 변경, routing 변경, out-of-scope feature 흔적을 하드 실패시킴

아직 부족한 것:

- 변경 파일 diff를 더 정교하게 노드 의미와 연결하는 규칙
- UI 수준의 `Reject / Retry` 전용 흐름

명세가 준비된 뒤에만 build를 시작한다.

이때 시스템은 아래 규칙을 반드시 지켜야 한다.

- 전체 그래프는 이해하되, 구현은 현재 단계만 한다.
- build를 시작할 때는 승인된 `.graphcoding/diagram.approved.json`을 기준으로 한다.
- build가 diagram generation을 다시 수행하거나 현재 draft diagram을 임의로 덮어쓰면 안 된다.
- 현재 단계에 꼭 필요한 최소 boundary만 stub 또는 contract로 둔다.
- 다음 단계 기능을 미리 구현하면 안 된다.
- 선택 범위를 넘는 UI나 로직을 과하게 만들면 안 된다.
- 현재 단계가 혼자 성립하지 않으면 build를 거부해야 한다.
- build나 검증이 실패하면 `.graphcoding/mistake.md`에 오류를 누적 기록하고, 같은 step 범위 안에서만 자동 repair pass를 다시 수행해야 한다.
- 이 repair loop는 무한정 돌면 안 되고 bounded attempt로 제한해야 한다.
- selection build는 `.graphcoding/current-step-contract.json`에 기록된 예산과 범위를 넘으면 안 된다.
- server-side verifier는 build 전후 diff를 비교해서 out-of-scope 변경을 자동 실패시켜야 한다.

step build의 결과는 실제 workspace에 누적 작성되어야 한다.

---

## 7. Step Test

### 7.0 Status
build 후 테스트를 돌리는 경로는 있고, selection build 이후 human step approval까지 연결된다. 다만 `단계별 누적 테스트 계약`은 아직 미완성이다.

각 단계가 끝났다고 인정되려면 반드시 테스트가 있어야 한다.

각 단계에서 최소한 다음이 필요하다.

- typecheck 통과
- build 통과
- 현재 단계의 테스트 통과
- 이전 승인 단계들의 핵심 테스트가 계속 통과

테스트가 실패하면 다음 단계로 넘어갈 수 없다.

즉, 단계 완료의 정의는 “코드가 써졌다”가 아니라 “테스트를 포함해 현재 단계가 검증되었다”여야 한다.

현재 구현 기준으로는 build 실패 시 마지막 검증 출력이 `.graphcoding/mistake.md`에 기록되고, 다음 repair pass가 그 파일을 읽고 같은 step을 계속 수정한다.

---

## 8. Human Approval

### 8.0 Status
이 단계는 부분 구현되었다.

현재 구현된 것:

- `Approve Current Step` 버튼: 구현됨
- selection build 성공 뒤 step approval 가능: 구현됨
- 승인된 step은 `.graphcoding/step-history.json`에 기록: 구현됨
- step approval 후 다음 reachable node 재계산: 구현됨

아직 부족한 것:

- `Reject / Retry` 전용 UI
- step 거부 사유 구조화
- human approval 메모 기록

테스트가 통과해도 자동으로 다음 단계로 넘어가지 않는다.

사람이 아래를 보고 승인해야 한다.

- 이번 단계에서 실제로 무엇이 만들어졌는지
- 현재 단계 범위를 넘지 않았는지
- 테스트가 맞게 작성되었는지
- 결과가 그래프 의도와 맞는지

사람이 승인하면 다음 reachable node가 열린다.

사람이 거부하면 아래 중 하나가 가능해야 한다.

- 현재 단계 재시도
- 그래프 수정
- 노드 설명 수정
- step split 또는 merge 재검토

---

## 9. Final Completion

### 9.0 Status
이 단계는 아직 구현되지 않았다.

마지막 단계까지 모두 승인되면 시스템은 전체 앱 기준으로 최종 정리를 한다.

최종 완료 조건은 다음과 같다.

- 모든 executable node가 완료 상태
- 마지막까지 누적 개발된 코드가 연결됨
- 전체 build 통과
- 전체 typecheck 통과
- 전체 핵심 테스트 통과
- 필요한 경우 최종 e2e 통과

이 조건을 만족해야 완성 앱으로 인정한다.

---

## State Model

### Graph State
- `draft`
- `approved`
- `invalidated`

### Node State
- `annotation`
- `reachable`
- `blocked`
- `approved`

### Meaning
- `annotation`: 설명용 node이며 step build 대상이 아님
- `reachable`: 지금 선택 가능
- `blocked`: 현재 단계로는 build 불가
- `approved`: 단계 완료

---

## What The System Must Guarantee

이 시스템은 반드시 아래를 보장해야 한다.

1. 항상 `Open Folder` 기준 workspace에서 실제 개발한다.
2. 하네스가 고정되지 않으면 diagram generation을 시작하지 않는다.
3. diagram generation은 사용자의 명시적 버튼 입력으로만 시작한다.
4. build/spec은 승인된 graph를 그대로 사용하며 draft diagram을 임의로 다시 생성하거나 덮어쓰지 않는다.
5. 처음에는 brief를 받아 AI가 전체 그래프 초안을 만든다.
6. 사람은 초기 그래프를 수정하고 승인할 수 있다.
7. 승인된 그래프 전체를 먼저 읽은 뒤 현재 단계만 구현한다.
8. 현재 단계가 불명확하면 build를 거부한다.
9. 각 단계 끝에는 반드시 테스트가 있다.
10. 사람 승인 없이는 다음 단계로 넘어가지 않는다.
11. 마지막 단계까지 완료되면 완성 앱이 된다.

---

## Current Default Decisions

현재 기준 기본 정책은 아래로 둔다.

- 실제 개발은 native workspace에서만 한다.
- `Open Folder -> Branch 판단 -> Harness -> Runtime Ready -> 사용자가 Diagram 버튼 클릭 -> Review -> Step Build` 순서를 따른다.
- 처음에는 brief를 바탕으로 AI가 초기 전체 그래프를 생성한다.
- 기본 셋업이 끝났다고 해서 diagram generation을 자동으로 시작하지 않는다.
- draft diagram은 자동 저장하고, build/spec의 source of truth는 승인된 graph로 사용한다.
- 다음 단계는 reachable node 중에서만 선택 가능하다.
- 1단계는 1 executable node만 구현한다.
- 현재 노드가 성립하지 않으면 자동 확장하지 않고 거부한다.
- 매 단계마다 cumulative core test를 수행한다.
- 사람은 그래프 승인과 각 step 결과 승인에 모두 참여한다.

---

## Success Criteria

이 문서가 맞게 구현되면 사용 흐름은 아래와 같아야 한다.

1. 사용자가 `Open Folder`로 작업 폴더를 연다.
2. 시스템이 managed/unmanaged를 판단하고 필요한 초기 분기를 고정한다.
3. 사용자가 하네스를 고정한다.
4. 사용자가 brief를 적는다.
5. 사용자가 diagram generation 버튼을 직접 누른다.
6. 시스템이 brief를 읽고 초기 전체 그래프를 생성한다.
7. 사람이 그래프를 수정한다.
8. 사람이 `Approve Graph`로 현재 draft를 승인된 graph로 확정한다.
9. 시스템이 승인된 graph 기준으로 reachable node를 계산한다.
10. 사용자가 첫 reachable node를 누른다.
11. 시스템이 현재 단계 명세를 만든다.
12. build를 수행한다.
13. 테스트를 수행한다.
14. 사람이 `Approve Current Step`으로 결과를 승인한다.
15. 다음 reachable node가 열린다.
16. 마지막 단계까지 반복한다.
17. 최종 전체 테스트를 통과한다.
18. 완성 앱이 된다.
