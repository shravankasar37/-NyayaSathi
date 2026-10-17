// Sample problems shown in the UI. Each one with a file in recordings/ can be replayed without the model
// (scripts/record.ts captures a real run of each).
export type Example = { id: string; label: string; text: string };

export const EXAMPLES: Example[] = [
  {
    id: "consumer-phone",
    label: "Defective phone",
    text: "I bought a Redmi phone for ₹18,499 from a shop in Pune on 2 September 2026. The screen stopped working after 10 days. The shop and the service centre both refuse to replace or repair it and say it is physical damage, which is false. I want a replacement or refund.",
  },
  {
    id: "rti-road",
    label: "RTI: road repair",
    text: "I want to know how much money our municipal corporation in Nashik spent on repairing the road in front of my house in 2025, which contractor did it and why it broke again within 3 months.",
  },
  {
    id: "fir-refused",
    label: "Police won't file FIR",
    text: "My motorcycle was stolen from outside my building in Thane last night. I went to the police station this morning but they refused to register an FIR and told me to come back after a week.",
  },
  {
    id: "upi-fraud",
    label: "UPI fraud call",
    text: "Today someone called pretending to be from SBI customer care, said my KYC was expiring, and asked me to share the OTP. After I shared it, ₹42,000 was debited from my account in two UPI transactions.",
  },
  {
    id: "hindi-job-scam",
    label: "हिंदी: ठगी",
    text: "एक आदमी ने मुझसे नौकरी दिलाने के नाम पर 25,000 रुपये लिए और अब फोन नहीं उठा रहा। मैं इंदौर में रहता हूं।",
  },
  {
    id: "out-of-scope",
    label: "Out of scope",
    text: "My brother and I are fighting over how to divide our late father's house in Kolhapur.",
  },
];

export const exampleByText = (text: string) => EXAMPLES.find((e) => e.text.trim() === text.trim());
