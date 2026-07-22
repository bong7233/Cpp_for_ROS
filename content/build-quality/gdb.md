# 7.4 gdb로 디버깅하기

::: lead
버그를 잡을 때 제일 먼저 손이 가는 도구는 `std::cout`이다. 의심되는 줄 위아래에 출력문을 박아 넣고, 다시 컴파일하고, 다시 돌리고, 값을 눈으로 읽는다. 이 방법은 늘 통하지만 늘 느리다 — 값을 하나 더 보고 싶으면 코드를 고치고 처음부터 다시 컴파일해야 하고, 이미 지나간 실행의 그 순간으로는 절대 돌아갈 수 없다. gdb는 정반대로 접근한다. 코드를 한 글자도 안 고치고, 실행 중인 프로그램을 원하는 줄에서 강제로 멈춰 세우고, 그 순간의 변수·호출 스택·메모리를 마음대로 들여다본다. 이 절은 헥사포드 다리 계산 코드와 실제로 세그폴트가 나는 코드, 스레드 세 개짜리 프로그램을 gdb 15.1로 직접 디버깅하면서 `break`, `run`, `next`/`step`, `print`, `continue`, `backtrace`, 조건부 중단점, 코어 덤프 사후 분석, 멀티스레드 전환, TUI 모드까지 전부 실제 출력으로 확인한다.
:::

## `std::cout`으로 잡을 수 있는 버그와 못 잡는 버그

다음은 헥사포드 다리 하나의 최대 리치(reach)를 계산하는 코드다. 좌굴절(coxa) 위치에서 시작해 대퇴절(femur)을 각도만큼 뻗고, 그 수평 거리에 경절(tibia) 길이를 더한다.

```cpp title="leg_reach.cpp"
#include <cmath>
#include <iostream>

struct LegSegments {
    double coxa;
    double femur;
    double tibia;
};

double segment_length(double dx, double dy) {
    double sq = dx * dx + dy * dy;
    double len = std::sqrt(sq);
    return len;
}

double leg_reach(const LegSegments& leg, double angle_deg) {
    double angle_rad = angle_deg * 3.14159265 / 180.0;
    double dx = leg.coxa + leg.femur * std::cos(angle_rad);
    double dy = leg.femur * std::sin(angle_rad);
    double horizontal = segment_length(dx, dy);
    double reach = horizontal + leg.tibia;
    return reach;
}

int main() {
    LegSegments legs[6] = {
        {0.05, 0.08, 0.12}, {0.05, 0.08, 0.12}, {0.05, 0.08, 0.12},
        {0.05, 0.08, -0.12}, {0.05, 0.08, 0.12}, {0.05, 0.08, 0.12},
    };
    double total = 0.0;
    for (int i = 0; i < 6; ++i) {
        double r = leg_reach(legs[i], 30.0);
        total += r;
        std::cout << "leg " << i << " reach = " << r << "\n";
    }
    std::cout << "total = " << total << "\n";
    return 0;
}
```

이 코드에는 캘리브레이션 테이블 어딘가에 부호가 뒤집힌 값이 하나 섞여 있다 — 실제 로봇에서 흔히 생기는, 다리 하나만 조립할 때 부품을 반대로 끼운 것 같은 실수를 흉내낸 것이다. 실행하면 다리 하나만 리치가 눈에 띄게 짧다.

```console
$ g++ -std=c++20 -Wall -Wextra -O0 leg_reach.cpp -o leg_reach
$ ./leg_reach
leg 0 reach = 0.24581
leg 1 reach = 0.24581
leg 2 reach = 0.24581
leg 3 reach = 0.00581019
leg 4 reach = 0.24581
leg 5 reach = 0.24581
total = 1.23486
```

(g++ 13.3.0 / Ubuntu 24.04 x86-64 실측.) 3번 다리만 `0.00581019`로 나머지의 40분의 1도 안 된다. 프린트 디버깅으로 이걸 쫓는다면 `leg_reach` 안에 `std::cout << leg.coxa << " " << leg.femur << " " << leg.tibia << "\n";`을 박아 넣고 다시 컴파일해야 한다. 그런데 값을 하나 더 보고 싶어지면 — 예를 들어 `angle_rad`가 라디안으로 제대로 변환됐는지도 궁금해지면 — 또 코드를 고치고 또 컴파일해야 한다. 여러 값을 한꺼번에 보려면 출력문이 함수 전체에 흩어지고, 다 확인했으면 그 출력문들을 전부 지워야 한다(안 지우면 다음 사람이 로그에서 이 디버깅 흔적을 마주친다). **더 근본적인 문제는 따로 있다.** 이 프로그램을 실행하는 그 순간, `leg_reach` 함수가 3번 다리를 계산하고 있는 바로 그 시점의 메모리 상태를 그대로 들여다볼 방법이 프린트 디버깅에는 없다 — 미리 그 지점에 출력문을 심어 놓지 않았다면 이미 늦었다. 코드를 재컴파일하지 않고, 실행 중인 프로세스를 원하는 줄에서 세워서 그 순간의 값을 그대로 읽는 도구가 gdb다.

## 디버그 심볼 없이 gdb를 켜면: `-g`가 왜 필요한가

`-g` 없이 컴파일한 바이너리로 gdb를 켜면 무슨 일이 일어나는지 먼저 실측한다.

```console
$ g++ -std=c++20 -Wall -Wextra -O0 leg_reach.cpp -o leg_reach_nog
$ gdb -q ./leg_reach_nog
Reading symbols from ./leg_reach_nog...
(No debugging symbols found in ./leg_reach_nog)
(gdb) break leg_reach
Breakpoint 1 at 0x1264
(gdb) run
Starting program: .../leg_reach_nog
[Thread debugging using libthread_db enabled]
Using host libthread_db library "/lib/x86_64-linux-gnu/libthread_db.so.1".

Breakpoint 1, 0x0000555555555264 in leg_reach(LegSegments const&, double) ()
(gdb) print leg
No symbol "leg" in current context.
(gdb) list
warning: 1      ./elf/<built-in>: No such file or directory
```

(gdb 15.1 / g++ 13.3.0 실측.) `break leg_reach`는 함수 이름만으로 걸렸다 — 심볼 테이블에 함수 이름과 시작 주소는 여전히 남아 있기 때문이다. 그런데 멈춘 자리를 보면 `leg_reach.cpp:17` 같은 파일·줄 정보 없이 `0x0000555555555264 in leg_reach(...)`라는 주소만 나온다. `print leg`는 아예 "No symbol"로 거부당했고, `list`는 소스 파일 자체를 못 찾는다. **-g 없이는 이름과 주소는 남지만, 그 이름이 소스 코드 어디에 대응하는지, 그 순간 지역 변수가 뭘 들고 있는지는 전부 사라진다.** 이제 `-g`를 붙여서 같은 프로그램을 다시 본다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -O0 leg_reach.cpp -o leg_reach
$ gdb -q ./leg_reach
Reading symbols from ./leg_reach...
(gdb) break leg_reach
Breakpoint 1 at 0x1271: file leg_reach.cpp, line 17.
(gdb) run
Starting program: .../leg_reach
[Thread debugging using libthread_db enabled]
Using host libthread_db library "/lib/x86_64-linux-gnu/libthread_db.so.1".

Breakpoint 1, leg_reach (leg=..., angle_deg=30) at leg_reach.cpp:17
17          double angle_rad = angle_deg * 3.14159265 / 180.0;
(gdb) print leg
$1 = (const LegSegments &) @0x7fffffffc560: {coxa = 0.050000000000000003, femur = 0.080000000000000002, tibia = 0.12}
(gdb) print angle_deg
$2 = 30
```

같은 소스, 같은 `-O0`, 딱 `-g` 하나 붙였을 뿐인데 완전히 다른 세계다. 중단점이 `leg_reach.cpp:17`이라는 정확한 줄에 걸리고, 매개변수 `leg`와 `angle_deg`의 실제 값이 그대로 찍힌다. `-g`는 실행 코드 자체를 바꾸지 않는다 — 컴파일러가 이미 알고 있던 정보(변수 이름, 타입, 소스 줄 번호와 기계어 주소의 대응표)를 바이너리 안에 추가로 얹어 둘 뿐이다. 그래서 `-g`를 붙였다고 실행 속도나 최적화가 달라지지 않는다.

::: note 이 책에서는 항상 -g로 컴파일한다
지금까지 이 책의 예제는 컴파일 명령에 `-g`를 안 붙인 곳도 있었을 것이다. gdb로 뭔가를 들여다볼 생각이면 `-g`를 습관적으로 붙여라. 배포용 바이너리에서 `-g`를 빼는 건 나중 문제다 — 지금은 개발 사이클 얘기다.
:::

## 중단점과 값 출력: break, run, print, list

방금 본 `break`/`run`/`print`가 gdb의 뼈대다. `break <함수 또는 파일:줄번호>`로 멈출 지점을 정하고, `run`으로 프로그램을 처음부터 실행해 그 지점에서 세우고, `print <표현식>`으로 그 순간의 값을 읽는다. `list`는 지금 멈춘 줄 주변의 소스를 보여준다(위에서 `-g` 없는 바이너리는 이게 실패했었다). 중단점은 함수 이름 대신 `break leg_reach.cpp:20`처럼 파일과 줄 번호로도 걸 수 있고, 이미 걸어 둔 중단점 목록은 `info breakpoints`로 확인한다.

::: tip 자주 쓰는 표현식
`print leg.tibia`처럼 멤버에 바로 접근할 수 있고, `print angle_deg * 2`처럼 그 자리에서 산술도 된다. `print/x`는 16진수로, `print sizeof(leg)`는 타입 크기까지 그대로 C++ 표현식으로 평가한다 — gdb의 `print`는 사실상 미니 C++ 인터프리터다.
:::

## next와 step: 함수 호출을 건너뛰는가 들어가는가

`leg_reach`는 내부에서 `segment_length`를 호출한다. 이 호출을 만났을 때 **건너뛸지 들어갈지**를 정하는 게 `next`와 `step`의 유일한 차이다. 먼저 `next`만 세 번 눌러 본다.

```console
$ gdb -q ./leg_reach
(gdb) break leg_reach
Breakpoint 1 at 0x1271: file leg_reach.cpp, line 17.
(gdb) run
Breakpoint 1, leg_reach (leg=..., angle_deg=30) at leg_reach.cpp:17
17          double angle_rad = angle_deg * 3.14159265 / 180.0;
(gdb) next
18          double dx = leg.coxa + leg.femur * std::cos(angle_rad);
(gdb) next
19          double dy = leg.femur * std::sin(angle_rad);
(gdb) next
20          double horizontal = segment_length(dx, dy);
```

세 번 다 `leg_reach` 안에서 한 줄씩 내려갔다. 이제 20번 줄, 바로 다음 줄이 `segment_length` 호출이다. 여기서 `next` 대신 `step`을 눌러 본다.

```console
(gdb) step
segment_length (dx=0.11928203232668705, dy=0.039999999958548645) at leg_reach.cpp:11
11          double sq = dx * dx + dy * dy;
(gdb) backtrace
#0  segment_length (dx=0.11928203232668705, dy=0.039999999958548645) at leg_reach.cpp:11
#1  0x0000555555555308 in leg_reach (leg=..., angle_deg=30) at leg_reach.cpp:20
#2  0x0000555555555493 in main () at leg_reach.cpp:33
```

(gdb 15.1 실측.) `step`은 `segment_length` **함수 내부로 들어가서** 그 첫 줄(11번)에 섰다. 만약 아까처럼 `next`를 눌렀다면 `segment_length` 호출 전체가 한 번에 실행되고 `leg_reach`의 21번 줄에 그대로 섰을 것이다 — 남의 함수(라이브러리 코드나, 지금 관심 없는 헬퍼 함수) 안까지 매번 들어가고 싶지 않을 때 `next`를 쓴다. `backtrace`(줄여서 `bt`)는 지금 멈춘 지점까지 어떤 [스택 프레임](#/memory-model)들이 쌓였는지 호출 순서대로 보여준다. `#0`이 지금 서 있는 곳(`segment_length`), `#1`이 그걸 부른 곳(`leg_reach`의 20번 줄), `#2`가 그 위(`main`의 33번 줄)다 — `main` → `leg_reach` → `segment_length` 순으로 호출됐다는 걸 역순으로 읽는다.

::: warn -O0로 디버깅하라
`-O2` 이상으로 컴파일하면 컴파일러가 함수를 인라인하고 변수를 레지스터에만 두거나 아예 없애 버린다. 그러면 `step`이 함수 경계를 못 찾고 `print`가 `<optimized out>`만 돌려준다. 디버깅하는 동안은 `-O0`을 쓰고, 최적화된 빌드에서만 재현되는 버그라면 `-Og`(디버깅 친화적 최적화) 정도로 타협한다.
:::

## 조건부 중단점: 반복문 안에서 딱 한 번만 멈추기

`leg_reach`는 6번 호출된다. 문제는 3번 다리 하나뿐인데 매번 멈춰서 다섯 번 `continue`를 치는 건 비효율적이다. `break <위치> if <조건>`으로 조건이 참일 때만 멈추게 한다.

```console
$ gdb -q ./leg_reach
(gdb) break leg_reach if leg.tibia < 0
Breakpoint 1 at 0x1271: file leg_reach.cpp, line 17.
(gdb) run
Starting program: .../leg_reach
leg 0 reach = 0.24581
leg 1 reach = 0.24581
leg 2 reach = 0.24581

Breakpoint 1, leg_reach (leg=..., angle_deg=30) at leg_reach.cpp:17
17          double angle_rad = angle_deg * 3.14159265 / 180.0;
(gdb) print leg
$1 = (const LegSegments &) @0x7fffffffc5a8: {coxa = 0.050000000000000003, femur = 0.080000000000000002, tibia = -0.12}
(gdb) continue
Continuing.
leg 3 reach = 0.00581019
leg 4 reach = 0.24581
leg 5 reach = 0.24581
total = 1.23486
[Inferior 1 (process 15692) exited normally]
```

(gdb 15.1 실측.) 0, 1, 2번 다리는 조건이 거짓이라 `leg 0 reach = ...`부터 세 줄이 화면에 그대로 찍히며 조용히 지나갔고, `tibia`가 음수인 3번 다리 차례가 되자 정확히 거기서만 멈췄다. `print leg`로 확인해 보니 `tibia = -0.12` — 캘리브레이션 테이블에 부호가 뒤집힌 값이 들어갔다는 게 이 자리에서 바로 드러난다. 반복문이 몇백, 몇천 번 도는 실전 코드에서 "특정 조건에서만" 재현되는 버그를 잡을 때 이 방식이 `next`를 수백 번 누르는 것보다 압도적으로 빠르다.

## 세그폴트 사후 분석: 크래시 지점과 호출 스택을 그대로 읽는다

이번엔 실제로 죽는 코드다. 로봇 관절 상태를 id로 찾아서 속도를 읽는데, 존재하지 않는 id를 조회하면 `find_joint`가 `nullptr`를 돌려준다 — 호출부가 그 `nullptr`를 확인 안 하고 그대로 역참조한다.

```cpp title="crash.cpp"
#include <iostream>
#include <vector>

struct JointState {
    double angle_rad;
    double velocity_rad_s;
};

double read_velocity(const JointState* state) {
    return state->velocity_rad_s;  // state가 nullptr이면 여기서 죽는다
}

JointState* find_joint(std::vector<JointState>& joints, int id) {
    for (auto& j : joints) {
        if (static_cast<int>(j.angle_rad) == id) {
            return &j;
        }
    }
    return nullptr;  // 못 찾으면 nullptr — 호출부가 확인 안 하면 사고
}

double poll_joint_velocity(std::vector<JointState>& joints, int id) {
    JointState* j = find_joint(joints, id);
    return read_velocity(j);
}

int main() {
    std::vector<JointState> joints = {{0.0, 1.5}, {1.0, -0.3}};
    for (int id = 0; id < 3; ++id) {
        double v = poll_joint_velocity(joints, id);
        std::cout << "joint " << id << " velocity = " << v << "\n";
    }
    return 0;
}
```

`joints`에는 id 0과 1만 있는데 `main`은 0, 1, 2를 조회한다. 그냥 실행하면 이렇게 죽는다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -O0 crash.cpp -o crash
$ ./crash
joint 0 velocity = 1.5
joint 1 velocity = -0.3
Segmentation fault (core dumped)
```

프린트 디버깅으로 이 크래시를 쫓으려면 `find_joint`와 `read_velocity` 양쪽에 출력문을 심고 재컴파일해야 한다. gdb는 그럴 필요가 없다 — 그냥 `run`으로 돌리다가 죽는 순간 자동으로 멈춰 세운다.

```console
$ gdb -q ./crash
(gdb) run
Starting program: .../crash
joint 0 velocity = 1.5
joint 1 velocity = -0.3

Program received signal SIGSEGV, Segmentation fault.
0x00005555555552b9 in read_velocity (state=0x0) at crash.cpp:10
10          return state->velocity_rad_s;  // state가 nullptr이면 여기서 죽는다
(gdb) backtrace
#0  0x00005555555552b9 in read_velocity (state=0x0) at crash.cpp:10
#1  0x00005555555553a8 in poll_joint_velocity (joints=std::vector of length 2, capacity 2 = {...}, id=2) at crash.cpp:24
#2  0x0000555555555440 in main () at crash.cpp:31
(gdb) frame 1
#1  0x00005555555553a8 in poll_joint_velocity (joints=std::vector of length 2, capacity 2 = {...}, id=2) at crash.cpp:24
24          return read_velocity(j);
(gdb) print id
$1 = 2
(gdb) print joints
$2 = std::vector of length 2, capacity 2 = {{angle_rad = 0, velocity_rad_s = 1.5}, {angle_rad = 1, velocity_rad_s = -0.29999999999999999}}
```

(gdb 15.1 실측.) `state=0x0`이 크래시 원인을 이미 말해 준다 — `read_velocity`가 nullptr를 그대로 역참조했다. `backtrace`로 어디서 이 nullptr가 넘어왔는지 한 단계 위(`frame 1`)로 올라가 보면 `poll_joint_velocity`가 `id=2`로 호출됐다는 게 나오고, `print joints`로 실제 벡터 내용을 확인하면 `angle_rad`가 0과 1인 원소 두 개뿐이다 — id 2는 애초에 존재하지 않는 관절이었다. 소스 코드를 한 줄도 안 고치고, 출력문 하나 안 심고 크래시 지점과 원인을 동시에 확인했다.

::: danger 실행 중이던 프로세스가 이미 죽어 사라졌을 때
지금은 gdb 안에서 `run`으로 직접 실행했기 때문에 죽는 순간 그대로 멈춰 세울 수 있었다. 그런데 실전에서는 사용자가 이미 겪은 크래시를 나중에 재현해야 하는 경우가 훨씬 흔하다 — 프로세스는 이미 사라졌고 남은 건 코어 덤프뿐이다. 이럴 때를 위한 방법이 다음 절이다.
:::

`ulimit -c unlimited`로 코어 덤프를 켜 두면, 프로세스가 죽을 때 그 순간의 메모리 전체를 `core` 파일에 남긴다.

```console
$ ulimit -c unlimited
$ ./crash
joint 0 velocity = 1.5
joint 1 velocity = -0.3
Segmentation fault (core dumped)
$ ls -la core
-rw------- 1 root root 569344 Jul 22 16:57 core
```

이 `core` 파일과 원래 실행파일을 같이 gdb에 넘기면, **프로세스가 이미 죽고 없는데도** 크래시 순간의 스택과 변수를 그대로 되살려 낸다.

```console
$ gdb -q ./crash core
Reading symbols from ./crash...
Core was generated by `./crash'.
Program terminated with signal SIGSEGV, Segmentation fault.
#0  0x0000557f1fc5f2b9 in read_velocity (state=0x0) at crash.cpp:10
10          return state->velocity_rad_s;  // state가 nullptr이면 여기서 죽는다
(gdb) backtrace
#0  0x0000557f1fc5f2b9 in read_velocity (state=0x0) at crash.cpp:10
#1  0x0000557f1fc5f3a8 in poll_joint_velocity (joints=std::vector of length 2, capacity 2 = {...}, id=2) at crash.cpp:24
#2  0x0000557f1fc5f440 in main () at crash.cpp:31
(gdb) frame 1
#1  0x0000557f1fc5f3a8 in poll_joint_velocity (joints=std::vector of length 2, capacity 2 = {...}, id=2) at crash.cpp:24
24          return read_velocity(j);
(gdb) print id
$1 = 2
(gdb) print joints
$2 = std::vector of length 2, capacity 2 = {{angle_rad = 0, velocity_rad_s = 1.5}, {angle_rad = 1, velocity_rad_s = -0.29999999999999999}}
```

(gdb 15.1 실측. 주소값은 ASLR 때문에 방금 `run`으로 직접 잡았을 때와 다르지만 — `0x...52b9`와 `0x...5f2b9`처럼 매번 바뀐다 — `backtrace`가 보여주는 함수 이름·인자·소스 줄은 완전히 동일하다.) `run`으로 실시간으로 잡을 때와 `gdb <실행파일> core`로 사후 분석할 때 나오는 정보가 사실상 같다는 게 핵심이다. **주소는 실행마다 다르지만, "무엇이 왜 죽었는가"라는 질문의 답은 코어 덤프 안에 고스란히 보존돼 있다.**

## 멀티스레드 디버깅 기초: info threads와 thread 전환

스레드 세 개가 각자 다리 하나씩을 맡아 각도를 갱신하는 코드로 멀티스레드 디버깅을 본다. [6.1 std::thread: 생성, join, 수명](#/threads)에서 만든 것과 같은 구조다.

```cpp title="threads_demo.cpp"
#include <atomic>
#include <chrono>
#include <iostream>
#include <thread>

std::atomic<bool> keep_running{true};

void control_loop(int leg_id) {
    double angle = 0.0;
    while (keep_running.load()) {
        angle += 0.01 * leg_id;  // 여기서 멈춰서 각 스레드의 angle을 비교한다
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    std::cout << "leg " << leg_id << " stopped at angle " << angle << "\n";
}

int main() {
    std::thread t1(control_loop, 1);
    std::thread t2(control_loop, 2);
    std::thread t3(control_loop, 3);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    keep_running.store(false);
    t1.join();
    t2.join();
    t3.join();
    return 0;
}
```

gdb는 프로세스 하나에 스레드가 여러 개 있으면 각 스레드에 번호를 매긴다. `continue`로 몇 번 더 진행시켜서 세 스레드가 전부 한 번씩 중단점에 걸리게 한 다음 `info threads`를 친다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -O0 threads_demo.cpp -o threads_demo -lpthread
$ gdb -q ./threads_demo
(gdb) break threads_demo.cpp:11
Breakpoint 1 at 0x12f2: file threads_demo.cpp, line 11.
(gdb) run
Thread 2 "threads_demo" hit Breakpoint 1, control_loop (leg_id=1) at threads_demo.cpp:11
11              angle += 0.01 * leg_id;  // 여기서 멈춰서 각 스레드의 angle을 비교한다
(gdb) continue
Continuing.
Thread 3 "threads_demo" hit Breakpoint 1, control_loop (leg_id=2) at threads_demo.cpp:11
11              angle += 0.01 * leg_id;  // 여기서 멈춰서 각 스레드의 angle을 비교한다
(gdb) continue
Continuing.
Thread 4 "threads_demo" hit Breakpoint 1, control_loop (leg_id=3) at threads_demo.cpp:11
11              angle += 0.01 * leg_id;  // 여기서 멈춰서 각 스레드의 angle을 비교한다
(gdb) info threads
  Id   Target Id                          Frame
  1    Thread ... (LWP 24557) "threads_demo" 0x00007ffff78ecadf in __GI___clock_nanosleep (...) at clock_nanosleep.c:78
  2    Thread ... (LWP 24561) "threads_demo" control_loop (leg_id=1) at threads_demo.cpp:11
  3    Thread ... (LWP 24562) "threads_demo" control_loop (leg_id=2) at threads_demo.cpp:11
* 4    Thread ... (LWP 24565) "threads_demo" control_loop (leg_id=3) at threads_demo.cpp:11
```

(gdb 15.1 실측. `LWP` 번호와 스레드 주소는 실행마다 달라진다.) Thread 1은 `main`이다 — 200ms를 자느라 `clock_nanosleep` 안에 있다. Thread 2, 3, 4가 각각 `leg_id=1`, `2`, `3`을 맡은 세 워커 스레드고, 지금 전부 11번 줄(중단점)에 멈춰 있다. `*` 표시가 붙은 4번이 현재 gdb가 보고 있는 스레드다. `thread <번호>`로 다른 스레드로 옮겨가서 각자의 지역 변수를 비교한다.

```console
(gdb) thread 2
[Switching to thread 2 (Thread ... (LWP 24561))]
#0  control_loop (leg_id=1) at threads_demo.cpp:11
11              angle += 0.01 * leg_id;  // 여기서 멈춰서 각 스레드의 angle을 비교한다
(gdb) print leg_id
$1 = 1
(gdb) print angle
$2 = 0.01
(gdb) thread 4
[Switching to thread 4 (Thread ... (LWP 24565))]
#0  control_loop (leg_id=3) at threads_demo.cpp:11
11              angle += 0.01 * leg_id;  // 여기서 멈춰서 각 스레드의 angle을 비교한다
(gdb) print leg_id
$3 = 3
(gdb) print angle
$4 = 0
```

Thread 2(`leg_id=1`)는 `angle`이 이미 `0.01`이다 — 이 스레드는 반복문을 한 바퀴 이상 돌았다. Thread 4(`leg_id=3`)는 `angle`이 아직 `0`이다 — 방금 막 생성돼서 첫 증가를 실행하기 전이다. **세 스레드가 같은 코드를 돌리는데도 진행 정도가 서로 다르다**는 걸 각 스레드의 스택 프레임에 직접 들어가서 확인한 것이다. gdb는 기본적으로 all-stop 모드로 동작한다 — 한 스레드가 중단점에 걸리면 나머지 스레드도 전부 같이 멈춘다. 그래서 `thread 2`, `thread 4`로 옮겨 다니는 동안 다른 스레드가 몰래 더 진행되는 일은 없다.

::: interview 레이스 컨디션을 gdb로 디버깅할 수 있는가
"gdb로 데이터 레이스를 잡을 수 있나?"는 흔히 나오는 함정 질문이다. 정답은 "제한적으로만"이다 — gdb는 스레드를 멈춰 세우는 도구고, 멈추는 행위 자체가 스레드 사이의 타이밍을 바꿔서 **레이스 컨디션이 사라지거나 다른 타이밍으로 재현**되게 만든다(하이젠버그 현상). 데이터 레이스 자체를 체계적으로 잡는 도구는 [7.5 ASan, UBSan, TSan](#/sanitizers)의 ThreadSanitizer다. gdb는 "이 스레드가 지금 뭘 들고 있나"를 확인하는 스냅샷 도구고, TSan은 "이 두 접근 사이에 동기화가 있었나"를 실행 전체에 걸쳐 추적하는 도구다 — 역할이 다르다는 걸 구분해서 답해야 한다.
:::

## TUI 모드: 소스 코드를 보면서 디버깅하기

지금까지는 `list`로 소스를 확인하고 다시 명령을 치는 식이었다. `layout src`(또는 `gdb -tui`로 처음부터 켜기)를 치면 화면 위쪽에 소스 코드가, 아래쪽에 명령 프롬프트가 항상 같이 떠 있는 화면으로 바뀐다. 실제로 `leg_reach`에서 중단점에 걸린 뒤 켜 본 화면이다.

```text nolines
┌─leg_reach.cpp──────────────────────────────────────────────────┐
│       10 double segment_length(double dx, double dy) {         │
│       11     double sq = dx * dx + dy * dy;                    │
│       12     double len = std::sqrt(sq);                       │
│       13     return len;                                       │
│       14 }                                                     │
│       15                                                       │
│       16 double leg_reach(const LegSegments& leg, double angle_deg) { │
│B+>    17     double angle_rad = angle_deg * 3.14159265 / 180.0; │
│       18     double dx = leg.coxa + leg.femur * std::cos(angle_rad); │
│       19     double dy = leg.femur * std::sin(angle_rad);       │
│       20     double horizontal = segment_length(dx, dy);        │
│       21     double reach = horizontal + leg.tibia;             │
│       22     return reach;                                      │
│       23 }                                                       │
│       24                                                          │
│       25 int main() {                                             │
│       26     LegSegments legs[6] = {                              │
└────────────────────────────────────────────────────────────────┘
In: leg_reach                                    L17   PC: 0x555555555271
(gdb)
```

(gdb 15.1 실측, 터미널 100열 캡처.) `B+>`가 찍힌 17번 줄이 중단점이 걸려 있고(`B`) 지금 실행이 멈춘 자리(`>`)라는 뜻이다. 이 상태에서 `next`, `step`, `print`를 그대로 치면 위쪽 소스 창의 강조 줄이 실시간으로 따라 움직인다 — 매번 `list`를 다시 칠 필요가 없다. `Ctrl+X` `Ctrl+A`로 TUI를 껐다 켤 수 있고, `layout regs`로 레지스터 창을 추가할 수도 있다. 명령줄 기반 `break`/`next`/`print`에 익숙해진 다음에 TUI를 켜는 걸 권한다 — 화면 배치보다 명령 자체를 먼저 손에 익혀야 나중에 원격 세션처럼 TUI가 안 되는 환경에서도 헤매지 않는다.

## 로보틱스 연결: 재현 안 되는 버그와 gdbserver 원격 디버깅

지금까지 본 모든 예제는 개발 머신에서 프로그램을 직접 실행하고 그 자리에서 gdb를 붙였다. 그런데 [7.2 CMake 심화](#/cmake-advanced)에서 크로스 컴파일을 다뤘던 것과 같은 문제가 디버깅에도 그대로 온다 — 헥사포드처럼 로봇 본체의 보드(Raspberry Pi, Jetson 등)에서만 재현되는 버그는, 그 값비싼 로봇 위에서 gdb를 통째로 돌리는 게 항상 편한 건 아니다. 센서가 실장돼 있어야만, 실제 부하가 걸려야만 나오는 버그라면 개발 머신으로 프로그램을 옮겨서 재현하는 것 자체가 불가능한 경우도 있다.

`gdbserver`는 이 문제를 가른다. 타겟 보드에서는 `gdbserver`가 프로그램을 대신 실행하며 최소한의 제어만 받고, 실제 gdb 세션(중단점, `print`, TUI 전부)은 개발 머신에서 그대로 돌아간다.

```console
# 타겟 보드(로봇)에서
$ gdbserver :2345 ./leg_reach

# 개발 머신에서
$ gdb -q ./leg_reach
(gdb) target remote 192.168.1.50:2345
```

`target remote`로 연결하고 나면 `break`, `next`, `print`, `backtrace` 전부 이 절에서 쓴 것과 완전히 똑같이 동작한다 — 프로그램은 로봇 보드에서 돌고 있는데, 디버깅 경험은 로컬과 차이가 없다. `ros2_control`의 `hardware_interface`처럼 실제 하드웨어(서보, IMU)가 연결돼 있어야만 문제가 재현되는 코드에서 이 방식이 유일한 선택지가 된다 — [10.10 ament, colcon, 패키지 구조](#/ament-colcon)와 [6.9 스레드 아키텍처 설계](#/thread-architecture)에서 다룬 실시간 제어 루프의 디버깅이 그 실전 사례다.

## 요약

- 프린트 디버깅은 값을 보고 싶을 때마다 코드를 고치고 재컴파일해야 하고, 이미 지나간 실행의 상태로 돌아갈 수 없다 — gdb는 코드를 안 고치고 실행 중인 프로세스를 원하는 지점에서 세워서 그 상태를 그대로 읽는다.
- `-g`는 실행 코드를 바꾸지 않고 소스 줄·변수 이름 대응표만 바이너리에 얹는다 — 이게 없으면 `break`는 걸려도 `print`와 `list`가 무력해진다(이 환경에서 실측 확인).
- `break`/`run`/`print`/`continue`가 기본 뼈대다. `next`는 함수 호출을 건너뛰고, `step`은 그 안으로 들어간다 — 실제로 `segment_length` 호출에서 `next`와 `step`의 결과가 갈리는 걸 확인했다.
- `backtrace`는 지금 멈춘 지점까지 쌓인 [스택 프레임](#/memory-model)을 호출 순서대로 보여준다.
- `break <위치> if <조건>`은 반복문 안에서 조건이 참일 때만 멈춘다 — 캘리브레이션 값이 음수인 다리 하나만 콕 집어 멈추는 걸 실측했다.
- 살아있는 프로세스든(`run` 후 크래시) 이미 죽고 남은 코어 덤프(`gdb <실행파일> core`)든, `backtrace`가 보여주는 크래시 지점과 호출 스택은 동일하다 — 주소값만 ASLR 때문에 실행마다 다르다.
- `info threads`는 프로세스 안의 모든 스레드와 각자 멈춘 위치를 보여주고, `thread <번호>`로 그 스레드의 스택 프레임으로 옮겨가 지역 변수를 비교한다.
- `layout src`(TUI 모드)는 소스 코드를 보면서 실시간으로 강조 줄이 따라 움직이는 화면을 켠다 — 명령어에 먼저 익숙해진 뒤에 켜는 걸 권한다.
- `gdbserver` + `target remote`로 타겟 보드에서 실행 중인 프로그램에 개발 머신의 gdb를 그대로 붙일 수 있다 — 실제 하드웨어가 있어야만 재현되는 버그에 유일한 선택지가 되는 경우가 많다.

::: quiz 연습문제
1. `-g` 없이 컴파일한 바이너리에서 `break`는 걸렸는데 `print`가 "No symbol"로 실패했다. `-g`가 정확히 무엇을 바이너리에 추가하길래 이 차이가 나는지 설명하라.
2. `next`와 `step`이 함수 호출을 만났을 때 각각 어떻게 다르게 동작하는지, 이 절의 `segment_length` 실측 결과를 근거로 설명하라.
3. (예측) `break leg_reach if leg.tibia < 0` 대신 `break leg_reach if angle_deg > 100`을 걸었다면 이 절의 6번 반복(`angle_deg`가 항상 30) 동안 중단점이 몇 번 걸릴지 예측하고 이유를 써라.
4. gdb로 실행 중에 잡은 크래시와 코어 덤프로 사후에 분석한 크래시에서, 주소값과 `backtrace`가 보여주는 함수·인자·소스 줄 중 어느 쪽이 실행마다 달라지고 어느 쪽이 같은지 이 절의 실측 결과로 답하라.
5. (실습, 코드 작성형) 이 절의 `crash.cpp`를 직접 타이핑하고, `read_velocity`가 `nullptr`를 받으면 조용히 죽는 대신 표준 에러에 경고를 찍고 안전한 기본값(예: 0.0)을 돌려주도록 고쳐라. 그다음 원래 죽던 입력(`id=2`)으로 다시 실행해서 더 이상 세그폴트가 안 나는지, `gdb -q ./crash` 안에서 `run`으로 확인하라.
:::

::: answer 해설
1. `-g`는 실행 코드 자체는 그대로 두고, 소스 파일·줄 번호와 기계어 주소의 대응표(줄 번호 정보), 지역 변수 이름과 그 변수가 스택의 어느 오프셋에 있는지에 대한 정보(디버그 정보)를 바이너리에 추가로 심는다. `-g` 없이도 심볼 테이블에 함수 이름과 시작 주소는 남아 있어서 `break 함수이름`은 걸리지만, 그 함수 안의 지역 변수 `leg`가 스택 어디에 있는지에 대한 정보가 없어서 `print leg`가 "No symbol"로 실패한다.
2. `next`는 현재 줄에 있는 함수 호출을 통째로 실행하고 다음 줄(같은 프레임)에 선다 — 이 절에서 20번 줄의 `segment_length(dx, dy)` 호출을 `next`로 넘겼다면 그 호출 전체가 한 번에 실행되고 `leg_reach`의 21번 줄에 곧장 섰을 것이다. 실제 시연에서는 20번 줄에서 `next` 대신 `step`을 눌렀고, `step`은 그 호출 안으로 들어가서 `segment_length`의 첫 줄(11번)에 섰다 — `backtrace`를 찍으면 `#0 segment_length`, `#1 leg_reach`로 새 프레임이 하나 늘어난 게 보인다.
3. 0번이다. 이 절의 모든 호출은 `leg_reach(legs[i], 30.0)`로 `angle_deg`가 항상 30이다. `angle_deg > 100`은 6번의 호출 전부에서 거짓이므로 중단점 조건이 한 번도 참이 되지 않고, 프로그램은 멈추지 않고 끝까지 실행된다.
4. 주소값(`0x0000555555555264`처럼 찍히는 값들)은 ASLR 때문에 실행마다, 그리고 실시간 실행이냐 코어 덤프 사후 분석이냐에 따라 달라진다 — 이 절의 실측에서 `run` 직후 크래시 주소와 `gdb ./crash core`로 연 크래시 주소가 서로 달랐다. 반면 `backtrace`가 보여주는 함수 이름(`read_velocity`, `poll_joint_velocity`, `main`), 인자 값(`id=2`), 소스 줄 번호(`crash.cpp:10`, `crash.cpp:24`)는 완전히 동일했다 — 크래시의 "원인"을 설명하는 정보는 주소와 무관하게 보존된다.
5. `read_velocity`를 `if (state == nullptr) { std::cerr << "경고: nullptr 관절 상태\n"; return 0.0; }`로 방어하도록 고치면, `id=2`로 호출해도 더 이상 역참조가 안 일어나서 세그폴트 없이 "joint 2 velocity = 0"이 찍히며 프로그램이 정상 종료돼야 한다. `gdb -q ./crash` 안에서 `run`을 치면 `Segmentation fault` 없이 `[Inferior 1 (process ...) exited normally]`로 끝나는 걸 확인할 수 있어야 한다.
:::

이 절의 세 프로그램(`leg_reach.cpp`, `crash.cpp`, `threads_demo.cpp`)은 전부 네 IDE 터미널에서 직접 타이핑해서 확인하라. 기준 명령: `g++ -std=c++20 -Wall -Wextra -g -O0 <파일> -o <실행파일> && gdb -q ./<실행파일>`. `threads_demo.cpp`는 `-lpthread`를 링크에 추가해야 한다. 조건부 중단점과 코어 덤프 분석은 특히 손으로 직접 쳐 봐야 한다 — 화면에 찍히는 실행 순서(어느 다리가 언제 출력되는지, 크래시 주소가 이 문서와 다른지)를 직접 눈으로 비교해 봐라.

**다음 절**: [7.5 ASan, UBSan, TSan](#/sanitizers) — gdb로 한 지점씩 손으로 잡던 메모리 버그와 데이터 레이스를, 컴파일 플래그 하나로 실행 전체에 걸쳐 자동으로 잡는 도구를 본다.
