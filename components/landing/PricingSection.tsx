'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from 'lucide-react';

const plans = [
  {
    name: "Free Plan",
    price: "$0",
    features: [
      "50 credits to start + 10 credits every 3 days",
      "Up to ~1.5 hours of Standard transcription",
      "Up to 50 YouTube caption downloads (1 credit each)",
      "Text transcript exports (TXT format)",
      "Never expires - use at your own pace",
      "Basic video metadata",
      "72-hour support response time"
    ],
    cta: "Get Started",
    popular: false,
  },
  {
    name: "Starter Plan",
    price: "$9.99",
    features: [
      "300 credits refreshed monthly",
      "Up to ~10 hours of Standard transcription",
      "OR up to ~5 hours of Premium transcription",
      "OR up to 300 YouTube caption downloads",
      "Basic & Extended summaries",
      "Text & SRT export formats",
      "API access",
      "48-hour support response time"
    ],
    cta: "Get Started",
    popular: true,
  },
  {
    name: "Pro Plan",
    price: "$19.99",
    features: [
      "750 credits refreshed monthly",
      "Up to ~25 hours of Standard transcription",
      "OR up to ~12.5 hours of Premium transcription",
      "OR up to 750 YouTube caption downloads",
      "Basic & Extended summaries with new content ideas",      
      "Text & SRT export formats",
      "API access",
      "24-hour support response time"
    ],
    cta: "Get Started",
    popular: false,
  },
];

export default function PricingSection() {
  return (
    <section id="pricing" className="py-12 md:py-20 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-lg text-muted-foreground">
            Choose the plan that&apos;s right for you. 
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`flex flex-col h-full ${plan.popular ? 'border-primary ring-2 ring-primary shadow-lg' : 'border-border'}`}
            >
              {plan.popular && (
                <div className="px-3 py-1 text-xs text-primary-foreground bg-primary font-semibold rounded-t-lg -mb-px text-center w-fit mx-auto relative -top-3">
                  Most Popular
                </div>
              )}
              <CardHeader className="pt-6">
                <CardTitle className="text-2xl font-semibold text-center">{plan.name}</CardTitle>
                <CardDescription className="text-center">
                  <span className="text-4xl font-extrabold text-foreground">{plan.price}</span>
                  <span className="text-muted-foreground">/month</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-grow">
                <ul className="space-y-3">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start">
                      <Check className="h-5 w-5 text-primary mr-2 flex-shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="mt-auto">
                <Button className="w-full" size="lg" variant={plan.popular ? 'default' : 'outline'}>
                  {plan.cta}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-xs italic text-muted-foreground">
            Credit usage: Caption Download (1 credit), Standard Transcription (5 credits/10 min), Premium Transcription (10 credits/10 min), Basic Summary (2 credits), Extended Summary (5 credits). Video length rounded up to nearest 10 minutes.
          </p>
        </div>

      </div>
    </section>
  );
} 