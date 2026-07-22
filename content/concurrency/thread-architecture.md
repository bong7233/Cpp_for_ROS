# 6.9 스레드 아키텍처 설계

::: lead
[6.1](#/threads)부터 지금까지 스레드 하나, 뮤텍스 하나, 큐 하나씩 따로 다뤘다 — `jthread` 하나를 만들고 세우는 법, `counter` 하나를 지키는 법, 생산자 하나와 소비자 하나가 항목 하나를 주고받는 법. 그런데 실제 헥사포드 제어 소프트웨어는 이 조각들을 전부, 동시에, 서로 다른 역할을 맡은 여러 스레드로 나눠 돌려야 한다. 센서를 읽는 스레드, 그 값을 바탕으로 관절을 계산하는 스레드, 그 계산 결과를 기록하는 스레드가 동시에 돌면서 서로 데이터를 주고받는다 — 이 절은 그 전체 그림을 실제로 설계하고, 실제로 컴파일해서, 실제로 몇 초간 돌려 세 스레드가 각자의 역할로 동시에 움직이는 것을 로그로 확인한다. [6.8](#/realtime)이 마지막 문단에서 예고한 그 설계이자, Part VI 전체를 종합하는 마지막 절이다.
:::

## 조각은 다 있는데 전체 그림이 없다

지금까지 배운 것을 나열하면 이렇다 — `jthread`와 `stop_token`으로 스레드 하나를 깔끔하게 세우는 법([6.1](#/threads)), 데이터 레이스가 왜 위험한지([6.2](#/data-races)), 뮤텍스로 임계 구역을 지키는 법과 그 대가([6.3](#/mutex)), `condition_variable`로 폴링 없이 기다리는 법([6.4](#/condvar)), `atomic`과 메모리 오더([6.5](#/atomic)), 락 없는 SPSC 큐([6.6](#/lockfree)), `async`/`future`로 태스크 하나의 결과를 받는 법([6.7](#/async-future)), 그리고 제어 루프가 왜 할당도 락도 못 견디는지와 `SCHED_FIFO`([6.8](#/realtime)). 여덟 개 절 전부 예제 하나에 스레드가 많아야 둘, 셋이었다 — 문제 하나를 딱 떨어지게 보여주려고 일부러 좁혀 놓은 그림이다.

실제 로봇 소프트웨어는 이렇게 좁지 않다. IMU와 여섯 다리의 인코더를 읽어야 하고, 그 값으로 관절 명령을 계산해야 하고, 그 계산 과정을 기록해서 나중에 무슨 일이 있었는지 돌아볼 수 있어야 한다. 이 세 가지 일은 성격이 완전히 다르다 — 센서 읽기는 주기적이지만 늦어도 로봇이 당장 넘어지지는 않고, 관절 계산은 [6.8](#/realtime)이 못박은 그대로 마감을 놓치면 그 자체로 실패이고, 기록은 느긋하게 해도 되지만 파일 쓰기라는 시스템 콜을 반드시 어딘가에서 불러야 한다. 이 세 가지를 전부 한 스레드에서 순서대로 처리하면 [6.1](#/threads)의 마지막 문단이 이미 지적한 문제가 그대로 재현된다 — 센서 읽기가 예상보다 오래 걸리는 순간 계산과 기록까지 전부 밀린다. 그러니 셋을 별도 스레드로 나눠야 하는데, 나누는 순간 새로운 질문이 생긴다. **스레드 사이의 경계를 어디에 긋고, 그 경계를 넘어가는 데이터는 어떤 도구로 옮기는가.** 이 절의 전부가 이 질문에 대한 답이다.

## 세 스레드, 세 개의 서로 다른 시간 제약

먼저 역할을 정한다. 헥사포드 제어 소프트웨어를 최소 세 스레드로 나눈다.

```text nolines
[센서 폴링 스레드]              [실시간 제어 루프 스레드]            [로깅/진단 스레드]
jthread + stop_token            jthread + stop_token, SCHED_FIFO     jthread, SCHED_OTHER
1kHz로 IMU/인코더를 읽는다        할당 없음, 락 없음, 논블로킹 소비      블록 허용, 실제 파일 I/O

      SpscRingBuffer<SensorSample>                    LogQueue(mutex + condition_variable)
      try_push / try_pop, 락 없음                       try_push(논블로킹) / wait_pop(블록)
      -------------------------->                       -------------------------->
```

세 스레드의 시간 제약이 전부 다르다는 게 이 설계의 핵심이다. 센서 스레드는 주기적으로 돌지만 한 번 늦어도 로봇이 즉시 위험해지지 않는다 — 다음 주기에 새 값을 다시 읽으면 된다. 제어 루프 스레드는 [6.8](#/realtime)의 hard real-time 그 자체다 — 이번 주기 안에 못 끝내면 그 다리는 낡은 명령으로 움직이거나 아예 멈추고, 나머지 다섯 다리와 어긋난다. 로깅 스레드는 시간 제약이 사실상 없다 — 로그 한 줄이 10ms 늦게 파일에 써져도 로봇은 전혀 모른다. 이 셋을 전부 같은 스케줄링 정책, 같은 동기화 도구로 다루면 가장 엄격한 제약(제어 루프)에 다른 둘을 억지로 맞추거나, 반대로 다른 둘의 느슨함이 제어 루프까지 새어 들어온다. 아키텍처 설계는 이 세 제약을 각자에 맞게 갈라놓는 일이다.

## 센서 → 제어: 왜 반드시 lock-free SPSC인가

센서 스레드가 데이터를 만들고 제어 루프가 그 데이터를 쓴다 — 생산자 하나, 소비자 하나로 역할이 고정된다는 점에서 [6.6](#/lockfree)이 정의한 SPSC(단일 생산자-단일 소비자) 조건과 정확히 일치한다. 이 채널에 뮤텍스+`condition_variable`([6.4](#/condvar))을 썼다면 무슨 일이 나는지는 이미 [6.8](#/realtime)에서 숫자로 봤다 — 경합이 붙은 뮤텍스의 최악값은 경합 없을 때보다 500배 뛰었고(63.3us → 32.6ms), 제어 루프 입장에서 32ms짜리 지연은 32번의 주기를 그대로 날리는 것과 같다. 제어 루프는 이 채널의 **소비자**이므로, 이 채널에서 조금이라도 블록될 가능성이 있으면 그 즉시 제어 루프의 실시간성이 깨진다. `SpscRingBuffer::try_pop()`은 데이터가 없으면 즉시 `false`를 돌려줄 뿐 절대 블록되지 않는다는 것 — [6.6](#/lockfree)이 실측한 그 성질이 이 채널에 정확히 필요한 성질이다.

반대로 이 채널에 `condition_variable`을 쓰지 않는 이유도 같은 데서 나온다. 조건 변수의 `wait()`는 [6.4](#/condvar)에서 본 대로 스레드를 진짜로 재운다 — 그런데 제어 루프는 "새 센서 데이터가 없으면 잠깐 잤다가 온다"가 아니라 "새 데이터가 없으면 마지막 값을 그대로 쓰고 이번 주기를 마감시간 안에 끝낸다"여야 한다. 자는 것 자체가 제어 루프에는 허용되지 않는 선택지다. SPSC 링 버퍼의 `try_pop()`이 이 자리에 맞는 이유는 딱 하나 — 값이 있든 없든 즉시 반환한다는 것.

## 제어 루프: 사전 할당 + 무락 + SCHED_FIFO

제어 루프 본체는 [6.8](#/realtime)의 체크리스트를 그대로 지킨다. 다음 코드가 이 절의 핵심이다.

```cpp title="hex_thread_arch.cpp — 제어 루프 (핵심부, 전체는 아래에)"
void control_loop_fn(std::stop_token st) {
    bool rt_ok = set_realtime_priority(90);   // pthread_setschedparam(SCHED_FIFO, 90)
    std::cout << "[제어] SCHED_FIFO(90) 적용: " << (rt_ok ? "성공" : "실패(SCHED_OTHER로 계속)") << "\n";

    constexpr auto period = std::chrono::microseconds(1000);  // 1kHz

    // 사전 할당 -- 루프 진입 전에 전부 만들고 한 번 써서 페이지 폴트까지 끝내 둔다
    std::array<double, 6> joint_cmd_deg{};
    joint_cmd_deg.fill(0.0);
    SensorSample last_sample{};
    bool have_sample = false;

    auto next = clk::now();
    while (!st.stop_requested()) {
        // (1) non-blocking 소비 -- 데이터가 없으면 블록하지 않고 마지막 값을 쓴다
        SensorSample fresh;
        if (g_sensor_to_control.try_pop(fresh)) { last_sample = fresh; have_sample = true; }

        // (2) 관절 명령 계산 -- 힙 할당도, 뮤텍스도 없다. 사전 할당된 배열만 갱신한다.
        //     실제 역기구학 계산은 9.5절의 몫이다. 여기서는 헤딩 오차를 각 다리에
        //     비례 보정으로 나눠 반영하는 자리표시자 계산으로 대신한다.
        double cmd_sum = 0.0;
        if (have_sample) {
            const double err = 0.0 - last_sample.imu_heading_deg;
            for (int i = 0; i < 6; ++i) {
                joint_cmd_deg[i] = last_sample.leg_angle_deg[i] + 0.5 * err;
                cmd_sum += joint_cmd_deg[i];
            }
        }

        // (3) 진단 로그는 절대 블록되지 않는 try_push로만 넘긴다 -- 실패하면 버린다
        g_control_to_log.try_push({0, have_sample ? last_sample.imu_heading_deg : 0.0, cmd_sum});

        next += period;
        std::this_thread::sleep_until(next);
    }
    // ... 종료 처리는 뒤에서 본다
}
```

세 가지가 전부 눈에 보인다. `std::array<double, 6> joint_cmd_deg`는 루프 진입 전에 딱 한 번 만들어지고 그 뒤로는 값만 덮어쓴다 — [6.8](#/realtime)의 회피 기법 1(사전 할당)이다. 관절 명령 계산은 사칙연산뿐이고 `new`도 `malloc`도, `std::vector::push_back` 같은 재할당 가능한 STL 호출도 없다. 데이터를 받는 쪽(`try_pop`)도 내보내는 쪽(`try_push`, 바로 다음 절에서 본다)도 전부 논블로킹이다. 이 환경에서 실제로 `SCHED_FIFO` 적용을 시도한 결과다.

```console
$ g++ -std=c++20 -O2 -Wall -Wextra hex_thread_arch.cpp -o hex_thread_arch -lpthread
$ ./hex_thread_arch
[제어] SCHED_FIFO(90) 적용: 성공
```

(g++ 13.3.0 / Ubuntu 24.04 / x86-64 실측, root 권한으로 실행 — [6.8](#/realtime)에서 확인한 것과 같은 이유로 성공했다. 일반 사용자 계정이라면 `EPERM`으로 실패할 수 있고, 그때는 `rtprio` 권한을 별도로 설정해야 한다.)

## 제어 → 로깅: mutex+condition_variable이면서도 제어 루프는 절대 안 막히는 이유

여기가 이 절에서 가장 조심스럽게 짚어야 할 지점이다. [6.8](#/realtime)의 체크리스트는 "경합 가능성이 있는 뮤텍스 `lock()`"을 제어 루프 본체 안에 두지 말라고 못박았다. 그런데 로깅 채널에는 뮤텍스와 `condition_variable`을 쓴다고 이 절 맨 앞의 그림에 이미 적어 놨다 — 모순처럼 보인다. 모순이 아닌 이유는 제어 루프가 이 채널에서 **한 번도 `lock()`을 부르지 않는다**는 데 있다.

```cpp title="hex_thread_arch.cpp — LogQueue::try_push (제어 루프가 부르는 쪽)"
bool try_push(const LogEntry& e) {
    std::unique_lock<std::mutex> lk(m_, std::try_to_lock);   // lock()이 아니라 try_lock() 시도
    if (!lk.owns_lock()) {        // 로깅 스레드가 마침 큐를 만지는 중이었다
        ++dropped_;
        return false;             // 기다리지 않고 그 자리에서 포기한다
    }
    if (count_ == buf_.size()) {  // 큐가 꽉 찼다 -- 로깅 스레드가 못 따라온다
        ++dropped_;
        return false;
    }
    buf_[tail_] = e;
    tail_ = (tail_ + 1) % buf_.size();
    ++count_;
    lk.unlock();
    cv_.notify_one();
    return true;
}
```

`std::unique_lock<std::mutex> lk(m_, std::try_to_lock)`은 [6.3](#/mutex)의 `lock()`과 완전히 다른 연산이다. `lock()`은 이미 누가 잠근 상태면 그 잠금이 풀릴 때까지 커널의 futex 대기 큐로 넘어가 진짜로 블록한다 — [6.3](#/mutex)/[6.8](#/realtime)에서 실측한 수십 마이크로초에서 수십 밀리초까지의 지연이 전부 이 경로에서 나온다. `try_lock()`(그리고 `std::try_to_lock` 태그로 생성한 `unique_lock`)은 그 경로를 아예 타지 않는다 — 락이 이미 잠겨 있으면 원자적 비교 연산 한 번으로 즉시 실패를 돌려주고 끝난다. [6.5](#/atomic)에서 본 경합 없는 원자적 연산 하나와 같은 비용 자릿수(나노초 단위)이지, [6.3](#/mutex)의 futex 대기 경로(마이크로초~밀리초)가 아니다. 그래서 제어 루프는 이 뮤텍스를 "쓰지만" 그 사용법이 절대 블록되지 않는 형태로 좁혀져 있다 — 락을 못 얻으면 기다리는 대신 그 진단 메시지 하나를 버린다. 로그 한 줄이 가끔 유실되는 건 감수할 수 있는 대가지만, 제어 주기 마감을 한 번이라도 놓치는 건 [6.8](#/realtime)의 정의대로 그 자체로 실패다 — 이 절의 설계는 그 우선순위를 코드로 못박은 것이다.

로깅 스레드 쪽은 정반대로 마음껏 블록해도 된다.

```cpp title="hex_thread_arch.cpp — LogQueue::wait_pop (로깅 스레드가 부르는 쪽)"
bool wait_pop(LogEntry& out) {
    std::unique_lock<std::mutex> lk(m_);
    cv_.wait(lk, [&] { return count_ > 0 || stop_; });   // 여기서는 정말로 잔다 -- 실시간 제약이 없다
    if (count_ == 0) return false;
    out = buf_[head_];
    head_ = (head_ + 1) % buf_.size();
    --count_;
    return true;
}
```

이게 [6.4](#/condvar)의 생산자-소비자 큐와 거의 같은 코드다 — 다른 점은 생산자(제어 루프)가 `lock()`이 아니라 `try_to_lock`으로만 접근한다는 것 하나뿐이다. 큐 저장소(`buf_`)도 생성자에서 `std::vector<LogEntry>(capacity)`로 한 번만 할당하고 그 뒤로는 고정 크기 링 버퍼처럼 인덱스만 돌린다 — [6.8](#/realtime)의 사전 할당 원칙을 이 큐에도 그대로 적용한 것이다.

## 전체 구현과 실측: 세 스레드가 실제로 동시에 돈다

센서 스레드는 [6.1](#/threads) 그대로 `jthread` + `stop_token`이다.

```cpp title="hex_thread_arch.cpp — 센서 폴링 스레드"
struct SensorSample {
    std::uint64_t seq = 0;
    double imu_heading_deg = 0.0;
    std::array<double, 6> leg_angle_deg{};
    clk::time_point stamp{};
};

void sensor_thread_fn(std::stop_token st) {
    constexpr auto period = std::chrono::microseconds(1000);  // 1kHz
    std::uint64_t seq = 0;
    auto next = clk::now();
    while (!st.stop_requested()) {
        SensorSample s;
        s.seq = seq;
        s.imu_heading_deg = 5.0 * std::sin(seq * 0.01);          // 흉내낸 IMU 헤딩
        for (int i = 0; i < 6; ++i)
            s.leg_angle_deg[i] = 30.0 + i + 2.0 * std::cos(seq * 0.02 + i);
        s.stamp = clk::now();

        if (g_sensor_to_control.try_push(s)) g_sensor_produced.fetch_add(1, std::memory_order_relaxed);
        else g_sensor_dropped.fetch_add(1, std::memory_order_relaxed);
        ++seq;
        next += period;
        std::this_thread::sleep_until(next);
    }
}
```

로깅 스레드는 실제 파일 쓰기를 여기서만 한다 — 제어 루프는 이 시스템 콜을 직접 부르지 않는다는 게 [6.8](#/realtime)의 "제어 루프 안에서 시스템 콜을 부르지 마라"는 원칙을 지키는 방법이다.

```cpp title="hex_thread_arch.cpp — 로깅 스레드"
void logging_thread_fn(const std::string& path) {
    std::ofstream out(path, std::ios::trunc);
    LogEntry e;
    while (g_control_to_log.wait_pop(e)) {
        out << e.control_seq << ',' << e.heading_used_deg << ',' << e.cmd_sum << '\n';
        g_log_written.fetch_add(1, std::memory_order_relaxed);
    }
    out.flush();
}
```

세 스레드를 전부 띄우고 3초 동안 돌리면서 500ms마다 카운터를 찍는다. 카운터는 전부 `std::atomic`이라 메인 스레드가 읽어도 안전하다([6.5](#/atomic)).

```console
$ g++ -std=c++20 -O2 -Wall -Wextra hex_thread_arch.cpp -o hex_thread_arch -lpthread
$ ./hex_thread_arch
=== 파이프라인 시작 ===
[제어] SCHED_FIFO(90) 적용: 성공
[상태] t=522ms  센서생산=523 센서드롭=0 제어주기=522 제어소비=498 로그기록=508 로그드롭=0
[상태] t=1011ms  센서생산=1012 센서드롭=0 제어주기=1011 제어소비=984 로그기록=1011 로그드롭=0
[상태] t=1501ms  센서생산=1501 센서드롭=0 제어주기=1501 제어소비=1474 로그기록=1501 로그드롭=0
[상태] t=2005ms  센서생산=2006 센서드롭=0 제어주기=2005 제어소비=1978 로그기록=2005 로그드롭=0
[상태] t=2509ms  센서생산=2510 센서드롭=0 제어주기=2510 제어소비=2483 로그기록=2509 로그드롭=0
=== 종료 시퀀스 시작 ===
[종료 1/3] 센서 스레드 정지 완료 (생산 3015, 드롭 0)
[제어] stop_requested 확인, 남은 센서 데이터 27개 마저 처리하고 종료
[종료 2/3] 제어 루프 정지 완료 (주기 3015, 소비 2988)
[로깅] 큐가 비고 stop 신호도 받음 -- 파일 flush 후 종료
[종료 3/3] 로깅 스레드 정지 완료 (기록 3016, 드롭 0)
=== 전체 종료 ===
최종 집계: 센서생산=3015 센서드롭=0 제어주기=3015 제어소비=2988 로그기록=3016 로그드롭=0
```

(g++ 13.3.0 / Ubuntu 24.04 / x86-64 실측, `-lpthread` 필수.) 세 스레드가 실제로 동시에 돌았다는 증거가 숫자로 다 나온다 — 센서가 1kHz로 3,015개를 만드는 동안 제어 루프도 3,015주기를 돌며 그중 2,988개를 즉시 소비했고, 나머지는 종료 시점에 27개를 한꺼번에 마저 처리했다(2,988 + 27 = 3,015 — 센서가 만든 데이터 중 단 하나도 유실되지 않았다). 로그는 3,016줄 기록됐고(제어 주기 3,015회 + 종료 시 드레인 1회분) 드롭은 0이다. 실제로 기록된 파일도 확인한다.

```console
$ head -3 hex_control_log.csv
0,0,0
1,0,194.528
2,0.0499992,194.371
$ tail -3 hex_control_log.csv
3013,-4.99945,210.48
3014,-4.99845,210.484
3015,-4.7842,0
```

각 줄이 `제어_시퀀스,사용한_헤딩값,명령합계` 형태로 실제 파일에 쌓였다 — 로깅 스레드가 제어 루프의 계산 결과를 정확히 받아 파일 I/O를 대신 처리한 것이다. 같은 바이너리를 세 번 더 돌려도 결과는 매번 안정적이다.

```console
$ for i in 1 2 3; do ./hex_thread_arch; done   # 마지막 집계 줄만 남김
최종 집계: 센서생산=3007 센서드롭=0 제어주기=3008 제어소비=3006 로그기록=3009 로그드롭=0
최종 집계: 센서생산=3003 센서드롭=0 제어주기=3004 제어소비=3002 로그기록=3005 로그드롭=0
최종 집계: 센서생산=3001 센서드롭=0 제어주기=3002 제어소비=3001 로그기록=3002 로그드롭=0
```

(g++ 13.3.0 실측, 3회 반복.) 매번 센서생산과 (제어소비 + 종료 시 드레인)이 정확히 일치했고, 드롭은 세 번 다 0이다. ThreadSanitizer로도 다시 확인한다.

```console
$ g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra hex_thread_arch.cpp -o hex_tsan -lpthread
$ ./hex_tsan; echo "exit=$?"
=== 파이프라인 시작 ===
[제어] SCHED_FIFO(90) 적용: 성공
...
=== 전체 종료 ===
최종 집계: 센서생산=3003 센서드롭=0 제어주기=3004 제어소비=3001 로그기록=3005 로그드롭=0
exit=0
```

(g++ 13.3.0 실측, 2회 반복 모두 경고 0건, 종료 코드 0.) 세 스레드가 `SpscRingBuffer`와 `LogQueue`를 통해 주고받는 모든 접근이 동기화됐다는 걸 TSan이 확인해 준다 — 다만 [6.6](#/lockfree)에서 이미 짚은 대로, TSan이 조용하다는 건 "데이터 레이스가 없다"는 것이지 "설계가 논리적으로 완벽하다"는 것과는 별개다. 이 절에서는 위 실측(생산=소비+드레인, 드롭 0)으로 그 논리적 정확성까지 따로 확인했다.

## 종료 시퀀스: 왜 이 순서인가

`main()`은 세 스레드를 정확히 이 순서로 세운다 — 세부는 다음 코드에 그대로 있다.

```cpp title="hex_thread_arch.cpp — 종료 시퀀스"
// (1) 센서 스레드부터 세운다 -- 더 이상 새 데이터가 생산되지 않게 한다
sensor_thread.request_stop();
sensor_thread.join();

// (2) 제어 루프에게 정지를 알린다 -- 루프는 남은 센서 데이터를 마저 처리하고 스스로 끝난다
control_thread.request_stop();
control_thread.join();

// (3) 로그 큐가 빌 때까지 기다렸다가 로깅 스레드를 세운다
g_control_to_log.request_stop();
logging_thread.join();
```

순서를 반대로 하면 무슨 문제가 나는지 하나씩 짚는다. 로깅 스레드를 먼저 세우면, 제어 루프가 아직 `try_push`로 넣고 있던 마지막 진단 메시지들이 갈 곳을 잃는다(`LogQueue`가 이미 정지 신호를 받았어도 `try_push` 자체는 계속 성공할 수 있어서 크래시는 안 나지만, 그 메시지들은 아무도 안 읽는다). 제어 루프를 센서보다 먼저 세우면, 센서 스레드가 계속 채워 넣는 `SpscRingBuffer`를 아무도 비우지 않아 큐가 가득 차고 센서 쪽 `try_push`가 계속 실패해 드롭 카운터만 올라간다. 그래서 순서는 "데이터가 흐르는 방향의 반대" — 가장 상류(센서)부터 잠그고, 그 잠금이 하류로 전파되는 걸 각 단계가 확인한 뒤에 다음 단계를 잠근다.

여기서 `jthread`가 실제로 단순하게 만들어 주는 건 딱 하나다 — **소멸자가 자동으로 `join()`을 불러준다는 것**([6.1](#/threads)). 이 절의 세 스레드 중 하나라도 `join()`을 명시적으로 호출하는 걸 잊었다면, `std::thread`였다면 `th3_noterminate.cpp`([6.1](#/threads))처럼 그 자리에서 `std::terminate`가 났을 것이다. `jthread`는 그 크래시를 원천 차단한다. 하지만 **"어떤 순서로 세울지", "언제 세워도 안전한지"를 판단하는 조정 로직 자체는 `jthread`가 대신 해주지 않는다** — 그건 여전히 이 절에서 짠 명시적인 세 줄(`request_stop()` → `join()`을 세 번 반복)의 몫이다. 실제로 이 프로그램에서 `main()`은 `logging_thread`, `control_thread`, `sensor_thread` 순서로 선언했으므로, 아무 명시적 정지 호출 없이 함수 끝에서 스코프를 벗어나기만 해도 소멸자는 선언의 **역순**(센서 → 제어 → 로깅)으로 불린다 — 공교롭게도 이 절이 원하는 순서와 같다. 그런데도 명시적으로 세 줄을 쓴 이유가 있다 — `logging_thread_fn`은 `stop_token`을 아예 받지 않는 함수라서, `jthread` 소멸자가 자동으로 부르는 `request_stop()`이 이 함수에는 아무 영향도 못 준다. 로깅 스레드를 실제로 멈추는 신호는 `jthread`의 것이 아니라 이 절이 직접 만든 `LogQueue::request_stop()`이다 — 이 신호를 부를 사람은 여전히 `main()`뿐이다. **`jthread`가 없애는 건 "join을 깜빡해서 나는 크래시"이지, "언제 무엇을 멈춰도 되는지"를 결정하는 설계 그 자체가 아니다.**

## 제어 루프만 특별 대우받는 이유, 다시 한번

세 스레드를 나란히 놓고 보면 이 차이가 선명해진다. 센서 스레드와 로깅 스레드는 둘 다 `SCHED_OTHER`(기본 정책) 그대로 돈다 — 센서 읽기가 어쩌다 몇 마이크로초 늦어도, 로그 한 줄이 몇 밀리초 늦게 파일에 써져도 로봇은 멀쩡하다. 로깅 스레드는 `condition_variable::wait()`로 마음껏 블록되고, 파일 I/O라는 시스템 콜도 직접 부른다 — [6.8](#/realtime)의 체크리스트가 금지하는 것들이지만, 여기서는 금지할 이유가 없다. 제어 루프만 다르다 — `SCHED_FIFO(90)`으로 우선순위를 올렸고, 루프 본체 안에는 힙 할당도 `lock()`도 시스템 콜도 하나도 없으며, 데이터를 주고받는 두 채널 모두 이 스레드 입장에서는 절대 블록되지 않는다(들어오는 쪽은 lock-free SPSC, 나가는 쪽은 `try_lock` 기반 드롭). 이 비대칭이 우연이 아니라 설계다 — **hard real-time 제약이 있는 스레드 하나만 특별 대우하고, 나머지는 평범하게 두는 것**이 세 스레드 모두를 실시간 등급으로 무겁게 만드는 것보다 훨씬 단순하고, [6.6](#/lockfree)이 이미 경고한 대로 락 없는 설계는 "없앨 구체적인 이유가 있을 때만" 쓰는 게 맞기 때문이다.

## 로보틱스 도메인: ros2_control이 이 구조를 프레임워크로 만든다

이 절에서 손으로 짠 것 — 스레드 역할 분리, lock-free 입력 채널, 논블로킹 진단 출력, `SCHED_FIFO`, 명시적 종료 시퀀스 — 를 `ros2_control`의 `hardware_interface`는 프레임워크 레벨에서 미리 갖춰 제공한다. 컨트롤러 매니저가 실시간 제어 스레드를 별도로 관리하고, 하드웨어 I/O는 그 스레드와 분리된 통신 계층을 거치며, 그 사이의 상태 버퍼 교체는 이 절의 `SpscRingBuffer`와 같은 계열의 락 없는 자료구조로 이뤄진다. [10.9 ros2_control과 hardware_interface](#/ros2-control)에서 이 프레임워크가 실제로 어떤 코드로 이 구조를 구현하는지 확인한다 — 이 절을 직접 짜 본 사람이라면 그 코드가 "왜 이렇게 생겼는가"를 이미 알고 시작하는 셈이다.

## 요약

- 지금까지 배운 스레드·뮤텍스·조건 변수·atomic·lock-free 큐는 전부 예제 하나에 스레드가 둘, 셋인 좁은 그림이었다 — 실제 로봇 소프트웨어는 역할이 다른 여러 스레드를 동시에 조립해야 한다.
- 센서 폴링, 실시간 제어 계산, 로깅/진단을 서로 다른 스레드로 나눈다 — 셋의 시간 제약이 완전히 다르기 때문이다(센서: 늦어도 다음 주기가 있음, 제어: hard real-time, 로깅: 사실상 무제약).
- 센서 → 제어 채널은 [6.6](#/lockfree)의 lock-free SPSC로 연결한다 — 제어 루프(소비자)가 절대 블록되면 안 되기 때문이다.
- 제어 → 로깅 채널은 mutex+`condition_variable`을 쓰되, 제어 루프(생산자)는 `try_to_lock`으로만 접근해 절대 블록되지 않는다 — 락을 못 얻거나 큐가 차면 그 진단 메시지를 버린다. 로깅 스레드(소비자)만 `wait()`로 진짜로 블록한다.
- 제어 루프 본체는 사전 할당된 배열만 쓰고, 힙 할당도 시스템 콜도 없으며, `SCHED_FIFO(90)`으로 우선순위를 올린다(실측: 이 환경에서 성공). 나머지 두 스레드는 `SCHED_OTHER`로 충분하다.
- 실제 3초 실행에서 센서생산과 (제어소비 + 종료 시 드레인)이 정확히 일치했고(3,015 = 2,988 + 27), 드롭은 0이었다 — 3회 반복 실행과 TSan 2회 반복 모두 같은 결과였다.
- 종료는 데이터 흐름의 반대 방향으로 세운다 — 센서부터 세우고, 제어 루프가 남은 데이터를 마저 처리한 뒤 스스로 끝나고, 로그 큐가 빌 때까지 기다렸다가 로깅 스레드를 세운다. `jthread`는 이 순서를 자동으로 정해 주지 않는다 — 자동으로 해주는 건 "join을 잊어도 크래시 안 남"뿐이고, 순서 자체는 여전히 명시적으로 짜야 한다.

::: quiz 연습문제
1~2번은 개념·설계 문제, 3번은 예측 문제, 4번은 네 컴퓨터에서 직접 코드를 짜고 컴파일·실행으로 확인하는 실습이다.

1. 이 절이 센서 → 제어 채널에는 lock-free SPSC를, 제어 → 로깅 채널에는 (제한된 형태의) mutex+condition_variable을 쓴 이유를 각 채널의 "실시간 제약을 진 쪽이 생산자인가 소비자인가"라는 관점에서 설명하라.

2. `LogQueue::try_push`가 `std::unique_lock<std::mutex> lk(m_, std::try_to_lock)`을 쓰는 대신 평범한 `std::lock_guard<std::mutex> lg(m_)`를 썼다면 제어 루프의 실시간성에 어떤 문제가 생기는지, [6.3](#/mutex)/[6.8](#/realtime)의 실측(경합 시 futex 대기 비용)을 근거로 설명하라.

3. (예측) `main()`에서 `sensor_thread.request_stop(); sensor_thread.join();` 두 줄을 아예 지우고, `sensor_thread`가 스코프 끝에서 소멸자로만 정리되게 두면(나머지 두 스레드는 이 절 그대로 명시적으로 세운다면) 프로그램이 여전히 올바르게 종료되는지 예측하고 근거를 써라. 힌트: `jthread`의 소멸자가 하는 일과, 이 절이 그럼에도 세 스레드 모두 명시적으로 정지시킨 이유를 떠올려라.

4. (실습, 코드 작성형) 이 절의 `hex_thread_arch.cpp`를 직접 타이핑하고, `g++ -std=c++20 -O2 -Wall -Wextra hex_thread_arch.cpp -o hex_thread_arch -lpthread`로 컴파일해서 3초간 실행하라. 종료 후 출력된 "최종 집계"에서 센서생산 값과 (제어소비 + 종료 로그의 "남은 센서 데이터" 개수)의 합이 정확히 일치하는지 직접 계산해서 확인하고, `g++ -std=c++20 -g -O0 -fsanitize=thread` 빌드로도 다시 실행해서 TSan 경고가 0건인지 확인하라. 성공 기준: 3회 이상 반복 실행 모두에서 두 수치가 항상 일치하고, TSan이 항상 조용하다.
:::

::: answer 해설
1. 센서 → 제어 채널에서 실시간 제약을 지는 쪽은 **소비자**(제어 루프)다 — 소비자가 절대 블록되면 안 되므로, `try_pop()`이 항상 즉시 반환하는 lock-free SPSC를 쓴다. 제어 → 로깅 채널에서 실시간 제약을 지는 쪽은 **생산자**(제어 루프 자신)다 — 그래서 생산자가 이 채널에서 절대 블록되지 않게(`try_to_lock` + 실패 시 드롭) 만들고, 대신 실시간 제약이 없는 소비자(로깅 스레드)는 `wait()`로 마음껏 블록하게 둔다. 두 채널 모두 "제어 루프가 이 채널에서 절대 블록되지 않는다"는 하나의 원칙을 지키지만, 그 원칙을 지키기 위해 채널을 어느 쪽에서 막았는지(생산자 쪽이냐 소비자 쪽이냐)가 다르다.
2. `lock_guard`는 이미 잠긴 뮤텍스를 만나면 `try_to_lock`과 달리 그 자리에서 진짜로 블록한다 — 로깅 스레드가 마침 큐를 만지는 중이라면 제어 루프는 그 임계 구역이 끝날 때까지 기다려야 한다. [6.3](#/mutex)/[6.8](#/realtime)에서 실측했듯 경합이 붙은 뮤텍스는 futex 대기 큐로 넘어가고, 최악값이 경합 없을 때보다 수백 배까지 뛸 수 있다(실측: 63.3us → 32.6ms). 제어 루프의 마감이 1ms인데 이 대기 하나가 몇십 마이크로초에서 몇 밀리초까지 튈 수 있다면, 로그 한 줄 남기려다 제어 주기를 통째로 놓치는 셈이다 — `try_to_lock`은 이 위험을 원천적으로 없앤다.
3. 여전히 올바르게 종료된다 — 아니, 정확히는 "센서 스레드 자체는" 문제없이 정리된다. `jthread`의 소멸자는 소멸 시점에 자동으로 `request_stop()`과 `join()`을 순서대로 불러주므로(`sensor_thread_fn`은 `stop_token`을 실제로 받아서 확인하는 함수이므로), `std::terminate` 같은 크래시는 나지 않는다. 다만 이 소멸은 `main()` 함수의 **끝**(스코프 종료 시점)에 일어나는데, 이 절의 설계는 "센서를 먼저 확실히 세운 뒤에 제어 루프와 로그 큐를 순서대로 세운다"는 걸 그 전에 명시적으로 실행해야 한다 — 소멸자에만 맡기면 제어 루프의 `request_stop()`/`join()`, 로그 큐의 `request_stop()`이 실행되는 시점이 뒤바뀌거나 어긋나서, 이 절이 실측한 "센서생산 = 제어소비 + 드레인"이라는 정확한 등식이 깨질 위험이 있다 — `jthread`가 크래시는 막아주지만 조정 로직의 순서까지 대신 짜주지는 않는다는 것이 정확히 이 문제의 핵심이다.
4. 실제로 실행하면 "최종 집계"의 센서생산 값과, 종료 로그에 찍힌 "남은 센서 데이터 N개"를 제어소비 값에 더한 합이 항상 정확히 일치해야 한다(이 절의 실측: 3,015 = 2,988 + 27). TSan 빌드로 반복 실행해도 매번 경고 없이 종료 코드 0이 나와야 한다 — `SpscRingBuffer`와 `LogQueue` 둘 다 이 절에서 이미 검증한 동기화 규칙을 그대로 따르기 때문이다.
:::

이 절의 코드는 전부 직접 쳐라 — 특히 종료 시퀀스의 세 단계는 순서를 하나라도 바꿔서 짜 보고 드롭 카운터가 실제로 올라가는지 직접 확인해 볼 가치가 있다. 기준 명령: `g++ -std=c++20 -O2 -Wall -Wextra hex_thread_arch.cpp -o hex_thread_arch -lpthread && ./hex_thread_arch`. TSan으로 재확인하려면 `g++ -std=c++20 -g -O0 -fsanitize=thread -Wall -Wextra hex_thread_arch.cpp -o hex_tsan -lpthread && ./hex_tsan; echo "exit=$?"`.

**다음 절**: [7.1 CMake 기초: 타겟과 프로퍼티](#/cmake-basics) — Part VI가 여기서 끝난다. 다음 파트부터는 지금까지 손으로 돌린 `g++` 명령 한 줄을, 타겟 중심으로 사고하는 CMake 빌드 시스템으로 옮긴다.
