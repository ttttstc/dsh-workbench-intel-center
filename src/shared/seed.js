/**
 * 首次打开时写入的种子数据。
 *
 * 只放两类内容：
 * 1. 一个关注主题（用户需求里给的示例）；
 * 2. 已经实际抓过官方页面核实过的卡片。每张卡片都写了 verifiedAt 与 sources；
 *    没有核实到的平台宁可不放，也不凭记忆编数字。
 */
const VERIFIED = '2026-11-09'

export function seedState() {
  return {
    version: 1,
    topics: [
      {
        id: 'topic-cloud-free',
        title: '各平台羊毛福利',
        note: 'PaaS、容器、VPS，重点筛选适合搭建轻量节点的服务：额度、规格、绑卡与休眠情况、避坑清单。'
      }
    ],
    cards: [
      {
        id: 'card-cloudflare-workers',
        title: 'Cloudflare Workers + Pages 免费计划',
        category: '边缘函数',
        tags: ['边缘', '无需绑卡', '全栈'],
        priority: 'high',
        summary: [
          '免费额度 10 万请求/天，单次调用 CPU 上限 10 毫秒',
          '出口带宽与静态资源请求完全不收费',
          'Pages 每月 500 次构建，单站点 2 万个文件',
          'KV / D1 / R2 各有独立免费额度，可拼出完整全栈',
          '超出额度直接返回 1027 报错，次日 UTC 零点重置'
        ],
        facts: [
          { label: '每日请求数', value: '100000 次/天（UTC 00:00 重置）' },
          { label: '单次 CPU 时间', value: '10 毫秒/次调用（免费计划）' },
          { label: '内存上限', value: '128 MB / isolate' },
          { label: '出口带宽', value: '不计费（无 egress / throughput 费用）' },
          { label: 'Pages 构建', value: '500 次/月，并发 1 个' },
          { label: 'D1 免费额度', value: '500 万行读/天、10 万行写/天、5 GB 存储' },
          { label: 'KV 免费额度', value: '10 万次读/天、1000 次写/天、1 GB 存储' },
          { label: 'R2 免费额度', value: '10 GB-month 存储、100 万 Class A/月' },
          { label: 'Worker 数量上限', value: '100 个/账户' }
        ],
        pros: [
          '免费额度同时覆盖计算与 KV/D1/R2 存储',
          '出口带宽和静态请求零成本，流量涨不涨账单',
          '注册只要邮箱，不需要信用卡'
        ],
        cons: [
          '免费 CPU 只有 10 毫秒/次，SSR、鉴权、大报文容易触发超限',
          'KV 免费写入仅 1000 次/天，写入型业务很快撞墙',
          '超限直接报错而不是降级，需要自己做失败兜底',
          '免费账户最多 100 个 Worker，多环境部署容易用满'
        ],
        score: 5,
        scoreReason: '免费额度覆盖边缘计算加三类存储，出口全免费，做轻量节点性价比最高。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Cloudflare Workers Pricing', url: 'https://developers.cloudflare.com/workers/platform/pricing/' },
          { title: 'Cloudflare Pages Limits', url: 'https://developers.cloudflare.com/pages/platform/limits/' }
        ],
        signup: '免费账户只要邮箱+密码，无需信用卡；升级 Workers Paid（$5/月起）时才需要绑卡',
        nextAction: '先部署一个 hello 接口实测 CPU 耗时，再决定鉴权与 DB 查询是否放边缘',
        note: '',
        flag: 'none'
      },
      {
        id: 'card-cloudflare-paid',
        title: 'Cloudflare Workers 付费计划（$5 起）',
        category: 'Serverless',
        tags: ['付费', '超量便宜'],
        priority: 'normal',
        summary: [
          '起步 $5/月，按账户最低消费',
          '含 1000 万请求/月与 3000 万 CPU 毫秒',
          '超出请求 $0.30/百万次，超出 CPU $0.02/百万毫秒',
          '单次 CPU 上限 5 分钟，出口带宽依然免费'
        ],
        facts: [
          { label: '起步价', value: '5 美元/月（账户最低消费）' },
          { label: '包含请求', value: '1000 万次/月' },
          { label: '超出请求单价', value: '$0.30 / 百万次' },
          { label: '包含 CPU', value: '3000 万 CPU 毫秒/月' },
          { label: '超出 CPU 单价', value: '$0.02 / 百万 CPU 毫秒' },
          { label: '单次 CPU 上限', value: '最长 5 分钟（默认 30 秒）' },
          { label: '官方示例', value: '1500 万请求/月、均值 7ms 合计约 $8/月' }
        ],
        pros: [
          '$5 起步含 1000 万请求，小项目基本够用',
          '出口与吞吐不收费，扩容不涨带宽费',
          '超额单价透明，为行业低位'
        ],
        cons: [
          '$5 是按账户最低消费，闲置也要付',
          'CPU 时间单独计量，重计算任务会叠加',
          '自助用户只能用 Standard 计费模型'
        ],
        score: 5,
        scoreReason: '$5 起步含 1000 万请求且出口免费，从免费档升级路径最平滑。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Cloudflare Workers Pricing', url: 'https://developers.cloudflare.com/workers/platform/pricing/' }
        ],
        signup: '需要绑定信用卡；可先用免费计划验证再升级',
        nextAction: '免费档撞到 10ms CPU 限制时，优先评估升到 $5 而不是换平台',
        note: '',
        flag: 'none'
      },
      {
        id: 'card-oracle-always-free',
        title: 'Oracle Cloud Always Free（ARM 2 核 12G）',
        category: '免费VPS',
        tags: ['ARM', '永久免费', '大内存'],
        priority: 'high',
        summary: [
          'ARM 免费规格为 2 OCPU + 12 GB（1500 OCPU 小时 / 9000 GB 小时每月）',
          '含 200 GB 块存储与 10 TB/月出站流量',
          '注册必须信用卡或借记卡做身份验证',
          '热门区域常报 out of host capacity，抢不到实例',
          '7 天内 CPU、网络、内存均低于 20% 会被判定空闲回收'
        ],
        facts: [
          { label: 'ARM 免费算力', value: '1500 OCPU 小时 + 9000 GB 小时/月' },
          { label: '折算规格', value: 'VM.Standard.A1.Flex：2 OCPU、12 GB 内存' },
          { label: '块存储', value: '200 GB（引导卷与块卷合计，限主区域）' },
          { label: '默认引导卷', value: '50 GB' },
          { label: 'AMD 微实例', value: '2 台 E2.1.Micro（1/8 OCPU、1 GB）' },
          { label: '对象存储', value: '20 GB' },
          { label: '每月出站流量', value: '10 TB' },
          { label: '试用额度', value: '$300，30 天' },
          { label: '空闲回收判定', value: '7 天内 CPU/网络/内存 95 分位均 < 20%' }
        ],
        pros: [
          '免费 2 核 12 GB，在同业免费档里规格最高',
          '含 200 GB 块存储与 10 TB/月出站流量',
          'Always Free 终身有效，不随 $300 试用到期消失'
        ],
        cons: [
          '注册强制信用卡/借记卡验证，不接受预付卡、虚拟卡',
          '热门区域经常抢不到 ARM 容量',
          '长期低负载会被判定空闲并回收',
          '每自然人限 1 个免费账户，闲置 30 天可被停用'
        ],
        score: 4,
        scoreReason: '免费规格与存储额度极优，但必须绑卡验证、容量难抢且有回收风险。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Oracle Always Free Resources', url: 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm' }
        ],
        signup: '需要信用卡或借记卡验证身份，明确不接受预付卡、虚拟卡；每自然人限 1 个免费账户',
        nextAction: '选非热门区域试开 A1，并挂一点轻负载（如定时任务）避免被判空闲回收',
        note: '',
        flag: 'none'
      },
      {
        id: 'card-flyio',
        title: 'Fly.io（已取消免费额度）',
        category: '容器PaaS',
        tags: ['需绑卡', '按秒计费'],
        priority: 'normal',
        summary: [
          '官方明确已无免费额度',
          '新账户仅 $1 试用信用，7 天或额度用尽',
          '试用后必须绑定信用卡才能继续',
          '最小机器 shared-cpu-1x 256MB 约 $2.19/30 天',
          '无平台月费，按秒计费，停机只收根盘'
        ],
        facts: [
          { label: '是否有免费额度', value: '无（官方原文：Is there a free tier? No.）' },
          { label: '试用额度', value: '$1，7 天' },
          { label: '试用是否需绑卡', value: '不需要' },
          { label: '试用后是否需绑卡', value: '必须，所有组织需信用卡在档' },
          { label: '最小机型', value: 'shared-cpu-1x 256MB，$0.0030/小时' },
          { label: '最小机型月费', value: '$2.19 / 30 天' },
          { label: '卷存储', value: '$0.15 / GB / 月' },
          { label: '出站流量', value: '$0.02/GB（北美/欧洲），亚太 $0.04/GB' }
        ],
        pros: [
          '按秒计费，停机只收根盘，小服务便宜',
          '无平台月费，账单即资源费',
          '试用阶段不绑卡就能验证部署流程'
        ],
        cons: [
          '完全没有免费额度，$1 试用 7 天即到期',
          '试用结束必须绑信用卡，无法长期零成本',
          '存储与出站单独计费，容易超预期',
          'Managed Postgres $38/月起，数据库比机器贵得多'
        ],
        score: 2,
        scoreReason: '平台可靠但已无免费额度，试用后必须付费绑卡，不适合零成本方案。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Fly.io Pricing', url: 'https://docs.fly.io/about/pricing' }
        ],
        signup: '试用注册无需信用卡；试用结束后必须绑定信用卡',
        nextAction: '只在需要「按秒计费 + 自动停机」的长期小服务时考虑，别当免费额度用',
        note: '',
        flag: 'none'
      },
      {
        id: 'card-render-free',
        title: 'Render Free 实例（750 小时/月）',
        category: '容器PaaS',
        tags: ['无需绑卡', '会休眠', '每日额度'],
        priority: 'high',
        summary: [
          '每个 workspace 每月 750 小时免费实例时长，不结转',
          '15 分钟无入站流量自动休眠，唤醒约 1 分钟',
          '免费 Web Service 规格 512 MB 内存、不到 1 CPU',
          '文件系统临时，Free 不能挂持久磁盘，休眠即丢文件',
          '免费 Postgres 1 GB，创建 30 天后过期'
        ],
        facts: [
          { label: 'Free 实例小时', value: '750 小时/workspace/月' },
          { label: '休眠规则', value: '15 分钟无入站流量后休眠' },
          { label: '冷启动', value: '约 1 分钟（期间显示加载页）' },
          { label: '免费规格', value: '512 MB RAM，不到 1 CPU，$0/月' },
          { label: '免费 Postgres', value: '1 GB 存储，30 天后过期' }
        ],
        pros: [
          '750 小时额度写得清楚，休眠期间不消耗时长',
          '支持自定义域名与托管 TLS',
          '支持回滚、日志流与服务预览'
        ],
        cons: [
          '15 分钟休眠 + 约 1 分钟冷启动，不适合常驻低延迟服务',
          'Free 不能挂持久磁盘，休眠重启文件丢失',
          '不支持 SSH、扩容、边缘缓存与一次性任务',
          '带宽或构建分钟超限且未绑卡时，免费服务会被暂停'
        ],
        score: 4,
        scoreReason: '免费额度最实用、规则最透明，代价是 15 分钟休眠和约 1 分钟冷启动。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Deploy for Free – Render Docs', url: 'https://render.com/docs/free' }
        ],
        signup: '注册无需绑卡；但超出免费带宽或构建分钟且未添加支付方式时，免费服务会被暂停',
        nextAction: '适合放演示站和低频接口；要常驻就用 Cloudflare Workers 或便宜 VPS',
        note: '',
        flag: 'none'
      },
      {
        id: 'card-railway',
        title: 'Railway Free 计划（每月 $1 额度）',
        category: '容器PaaS',
        tags: ['按秒计费', '额度很小'],
        priority: 'normal',
        summary: [
          '新用户 30 天试用 + 一次性 $5 额度',
          '试用结束转入 Free 计划，每月仅 $1 免费额度',
          'Free 单服务上限 1 vCPU / 0.5 GB 内存',
          '按秒计费，Hobby 最低 $5/月并含 $5 额度'
        ],
        facts: [
          { label: '免费试用', value: '30 天 + 一次性 $5' },
          { label: 'Free 计划', value: '$0/月，每月 $1 额度，不结转' },
          { label: 'Free 服务规格', value: '1 vCPU / 0.5 GB RAM / 0.5 GB 卷' },
          { label: 'Hobby 计划', value: '$5/月最低消费（含 $5 额度）' },
          { label: '按量价格', value: 'CPU $0.00000772/vCPU·秒；内存 $0.00000386/GB·秒；出口 $0.05/GB' }
        ],
        pros: [
          '按秒计费，用例极小时非常便宜',
          '无信用卡也能注册并试用',
          '保留独立 Free 计划，不是纯试用'
        ],
        cons: [
          'Free 每月只有 $1 额度，跑常驻服务很快超',
          '试用后未验证的账号网络访问受限',
          '免费单服务仅 1 vCPU / 0.5 GB'
        ],
        score: 3,
        scoreReason: '仍保留真正的 Free 计划，但 $1/月只够跑极轻量 demo，长期免费几乎不可行。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Railway Pricing', url: 'https://railway.com/pricing' }
        ],
        signup: '无需信用卡；用 GitHub 连接可拿全量试用，未验证账号网络访问受限',
        nextAction: '只在「按秒计费的临时环境」场景用，别指望它长期免费用',
        note: '',
        flag: 'none'
      },
      {
        id: 'card-koyeb',
        title: 'Koyeb 永久免费实例（0.1 vCPU / 512 MB）',
        category: '容器PaaS',
        tags: ['永久免费', '必须绑卡', 'scale-to-zero'],
        priority: 'normal',
        summary: [
          '所有计划都含 1 个免费实例：0.1 vCPU / 512 MB',
          '支持 scale-to-zero，按秒计费',
          '必须始终保留一张有效支付方式，否则无法使用',
          '免费 Postgres 每月 5 小时、1 GB 存储'
        ],
        facts: [
          { label: '免费实例', value: '0.1 vCPU / 512 MB RAM（所有计划内含）' },
          { label: 'Starter 计费', value: '按需付费，只算超出免费实例的部分' },
          { label: 'PRO / SCALE', value: '$29/月（含 $10 计算额度）/ $299/月（含 $100）' },
          { label: 'Eco 实例', value: '部分区域最低 $1.61/月起' },
          { label: '免费 Postgres', value: '每月 5 小时，1 GB 存储' }
        ],
        pros: [
          '免费实例是永久存在，不只是试用',
          '支持 scale-to-zero 与按秒计费',
          '控制面板可在 Starter / Pro / Scale 间自助切换'
        ],
        cons: [
          '免费实例仅 0.1 vCPU / 512 MB，只够跑玩具服务',
          '必须始终有一张有效卡，删卡需注销账户',
          '已并入 Mistral AI，免费政策有变动风险'
        ],
        score: 3,
        scoreReason: '免费实例确实永久，但 0.1 vCPU 与强制绑卡让它只适合验证部署。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Koyeb Pricing FAQ', url: 'https://www.koyeb.com/docs/faqs/pricing' }
        ],
        signup: '必须绑卡（Stripe 处理，支持 Visa/Mastercard/银联等），账户须始终保留一种有效支付方式',
        nextAction: '拿它当「免费验证部署流程」的沙盒，正式跑服务就换平台',
        note: '',
        flag: 'none'
      },
      {
        id: 'card-cloud-run',
        title: 'Google Cloud Run 免费额度',
        category: 'Serverless',
        tags: ['必须绑卡', '缩容到零'],
        priority: 'high',
        summary: [
          '每月 200 万次请求免费',
          '请求计费另有 18 万 vCPU·秒 + 36 万 GiB·秒/月',
          '实例计费额度更高：24 万 vCPU·秒 + 45 万 GiB·秒',
          '缩容到零必然有冷启动延迟',
          '必须绑卡并开通计费账号'
        ],
        facts: [
          { label: '免费请求数', value: '200 万次/月' },
          { label: '请求计费额度', value: '180,000 vCPU·秒 + 360,000 GiB·秒/月' },
          { label: '实例计费额度', value: '240,000 vCPU·秒 + 450,000 GiB·秒/月' },
          { label: '超出单价', value: 'CPU $0.000024/vCPU·秒；内存 $0.0000025/GiB·秒；请求 $0.40/百万' },
          { label: '新用户赠金', value: '$300，90 天内有效' }
        ],
        pros: [
          '免费额度在这几家里给得最足，200 万请求覆盖多数小站',
          '缩容到零，只对用过的实例按秒计费',
          '100 毫秒粒度计费，定价透明'
        ],
        cons: [
          '缩容到零必然有冷启动延迟',
          '必须绑卡并开通计费账号',
          '最小实例保活按闲置时间计费',
          '价格随区域变化，免费额度按账单账号合并计算'
        ],
        score: 4,
        scoreReason: '免费额度最宽，代价是必须绑卡、缩容到零后有冷启动。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Cloud Run Pricing', url: 'https://cloud.google.com/run/pricing' }
        ],
        signup: '必须绑卡（或有其他支付方式），部分国家还需验证银行账户',
        nextAction: '先按 200 万请求/月估算，再把镜像部署上去实测冷启动是否可接受',
        note: '',
        flag: 'none'
      },
      {
        id: 'card-hf-spaces',
        title: 'Hugging Face Spaces（免费 CPU 2 核 16G）',
        category: '容器PaaS',
        tags: ['模型演示', '磁盘非持久', '有付费墙'],
        priority: 'normal',
        summary: [
          'CPU Basic 免费：2 vCPU / 16 GB 内存',
          '新建 Gradio 或 Docker Space 需付费计划（PRO $9/月）',
          '免费账号可保留 2 个 ZeroGPU Gradio Space',
          '磁盘 50 GB 非持久，闲置会休眠，重启丢改动'
        ],
        facts: [
          { label: 'CPU Basic', value: '2 vCPU / 16 GB RAM，每小时 $0' },
          { label: '磁盘', value: '50 GB，非持久' },
          { label: '免费账号配额', value: '最多 2 个跑 ZeroGPU 的 Gradio Space' },
          { label: '创建 Gradio/Docker Space', value: '需付费计划，个人 PRO $9/月' },
          { label: 'CPU Upgrade', value: '8 vCPU / 32 GB，$0.03/小时' }
        ],
        pros: [
          'CPU Basic 免费且给到 16 GB 内存，跑 demo 很宽裕',
          'ZeroGPU 免费提供 GPU 推理额度',
          '可从 GitHub 仓库一键部署'
        ],
        cons: [
          '新建 Gradio/Docker Space 已进入付费墙',
          '免费硬件闲置后自动休眠，唤醒有等待',
          '磁盘非持久，重启或休眠会丢改动',
          '免费账号只保留 2 个 ZeroGPU Space'
        ],
        score: 2,
        scoreReason: '免费硬件仍在，但新建运行型 Space 需付费，纯免费用户只剩静态页和 2 个 ZeroGPU 名额。',
        status: 'confirmed',
        verifiedAt: VERIFIED,
        sources: [
          { title: 'Spaces Overview – Hugging Face', url: 'https://huggingface.co/docs/hub/spaces-overview' }
        ],
        signup: '静态 Space 免费；创建/托管 Gradio 或 Docker Space 需付费计划（PRO $9/月）',
        nextAction: '只用来放模型演示；要长期跑就用 Cloud Run 或 VPS',
        note: '',
        flag: 'none'
      }
    ],
    linuxdo: {
      updatedAt: '',
      date: '',
      keywords: ['羊毛', '薅'],
      items: []
    },
    x: {
      updatedAt: '',
      date: '',
      keywords: ['羊毛', '薅'],
      items: []
    },
    radar: {
      updatedAt: '',
      date: '',
      keywords: ['免费', '限免', '优惠'],
      items: []
    },
    lastReviewedAt: '',
    updatedAt: ''
  }
}
