import type { PaymentProviderReadiness } from './types'

export function getPaymentProviderReadiness(): PaymentProviderReadiness[] {
  return [
    {
      id: 'stripe',
      name: 'Stripe deposits',
      status: process.env.STRIPE_SECRET_KEY ? 'configured' : 'not_configured',
      notes: 'Prepared for deposit visibility only; processor actions are not connected here.',
    },
    {
      id: 'paypal',
      name: 'PayPal deposits',
      status: process.env.PAYPAL_CLIENT_ID ? 'configured' : 'not_configured',
      notes: 'Prepared for future deposit status visibility only.',
    },
    {
      id: 'square',
      name: 'Square deposits',
      status: process.env.SQUARE_ACCESS_TOKEN ? 'configured' : 'not_configured',
      notes: 'Prepared for future deposit status visibility only.',
    },
    {
      id: 'ach_placeholder',
      name: 'ACH deposit placeholder',
      status: 'placeholder',
      notes: 'No account/routing storage. Secure provider integration required later.',
    },
    {
      id: 'manual_proof',
      name: 'Manual proof upload',
      status: 'configured',
      notes: 'Accepts proof metadata only; does not confirm deposits by itself.',
    },
  ]
}
